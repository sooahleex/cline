import type Anthropic from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { findLastIndex } from "@shared/array"
import { COMPLETION_RESULT_CHANGES_FLAG } from "@shared/ExtensionMessage"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import { PROMPTS } from "../../../planning/planning_prompt"
import { PHASE_RETRY_LIMIT } from "../../../planning/utils"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class AttemptCompletionHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.ATTEMPT

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	/**
	 * Handle partial block streaming for attempt_completion
	 * Matches the original conditional logic structure for command vs no-command cases
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const result = block.params.result
		const command = block.params.command

		if (!command) {
			// no command, still outputting partial result
			await uiHelpers.say(
				"completion_result",
				uiHelpers.removeClosingTag(block, "result", result),
				undefined,
				undefined,
				block.partial,
			)
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		// Validate required parameters
		if (!result) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "result")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Show notification if enabled
		if (config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Task Completed",
				message: result.replace(/\n/g, " "),
			})
		}

		const addNewChangesFlagToLastCompletionResultMessage = async () => {
			// Add newchanges flag if there are new changes to the workspace
			const hasNewChanges = await config.callbacks.doesLatestTaskCompletionHaveNewChanges()
			const clineMessages = config.messageState.getClineMessages()

			const lastCompletionResultMessageIndex = findLastIndex(clineMessages, (m: any) => m.say === "completion_result")
			const lastCompletionResultMessage =
				lastCompletionResultMessageIndex !== -1 ? clineMessages[lastCompletionResultMessageIndex] : undefined
			if (
				lastCompletionResultMessage &&
				lastCompletionResultMessageIndex !== -1 &&
				hasNewChanges &&
				!lastCompletionResultMessage.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG)
			) {
				await config.messageState.updateClineMessage(lastCompletionResultMessageIndex, {
					text: lastCompletionResultMessage.text + COMPLETION_RESULT_CHANGES_FLAG,
				})
			}
		}

		// Remove any partial completion_result message that may exist
		// PreToolUse hook inserts messages after the partial, so we need to search backwards to find it
		const clineMessages = config.messageState.getClineMessages()
		const partialCompletionIndex = findLastIndex(
			clineMessages,
			(m) => m.partial === true && m.type === "say" && m.say === "completion_result",
		)
		if (partialCompletionIndex !== -1) {
			const updatedMessages = [
				...clineMessages.slice(0, partialCompletionIndex),
				...clineMessages.slice(partialCompletionIndex + 1),
			]
			config.messageState.setClineMessages(updatedMessages)
			await config.messageState.saveClineMessagesAndUpdateHistory()
		}

		config.taskState.phaseFinished = true // reset phase finished flag
		let commandResult: any
		const lastMessage = config.messageState.getClineMessages().at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask !== "command") {
				// haven't sent a command message yet so first send completion_result then command
				const completionMessageTs = await config.callbacks.say("completion_result", result, undefined, undefined, false)
				await config.callbacks.saveCheckpoint(true, completionMessageTs)
				await addNewChangesFlagToLastCompletionResultMessage()
				telemetryService.captureTaskCompleted(config.ulid)
			} else {
				// we already sent a command message, meaning the complete completion message has also been sent
				await config.callbacks.saveCheckpoint(true)
			}

			// Attempt completion is a special tool where we want to update the focus chain list before the user provides response
			if (!block.partial && config.focusChainSettings.enabled) {
				await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
			}

			// complete command message - need to ask for approval
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("command", command, config)
			if (!didApprove) {
				return formatResponse.toolDenied()
			}

			// User approved, execute the command
			const [userRejected, execCommandResult] = await config.callbacks.executeCommandTool(command!, undefined) // no timeout for attempt_completion command
			if (userRejected) {
				config.taskState.didRejectTool = true
				return execCommandResult
			}
			// user didn't reject, but the command may have output
			commandResult = execCommandResult
		} else {
			// Send the complete completion_result message (partial was already removed above)
			const completionMessageTs = await config.callbacks.say("completion_result", result, undefined, undefined, false)
			await config.callbacks.saveCheckpoint(true, completionMessageTs)
			await addNewChangesFlagToLastCompletionResultMessage()
			telemetryService.captureTaskCompleted(config.ulid)
		}

		const handleCompletionResult = async (): Promise<string> => {
			const { response, text, images, files: completionFiles } = await config.callbacks.ask("completion_result", "", false)

			if (response === "yesButtonClicked") {
				return ""
			}

			await config.callbacks.say("user_feedback", text ?? "", images, completionFiles)
			return ""
		}

		const handleAllPhasesComplete = async (phaseTracker: any): Promise<void> => {
			const shouldRetry = await config.sidebarController.task?.askUserApproval(
				"ask_final_retry",
				PROMPTS.FINAL_RETRY_PHASE_ASK,
			)

			if (shouldRetry && phaseTracker.canRetryCurrentPhase()) {
				await config.callbacks.say("text", `🔄 **Phase 재시도**\n\n현재 Phase를 다시 시작합니다.`)
				await config.sidebarController.task?.retryCurrentPhase()
				return
			} else if (shouldRetry && !phaseTracker.canRetryCurrentPhase()) {
				await config.callbacks.say("text", phaseTracker.getRetryLimitMessage())
			} else {
				await config.callbacks.say("text", `✅ **모든 Phase 완료**\n\n모든 Phase가 완료되었습니다.`)
			}
			await handleCompletionResult()
		}

		const handlePartialPhasesComplete = async (phaseTracker: any): Promise<void> => {
			const approveProceed = await config.sidebarController.task?.askUserApproval(
				"ask_proceed",
				PROMPTS.MOVE_NEXT_PHASE_ASK,
			)

			if (approveProceed) {
				// Move to next phase
				if (phaseTracker?.hasNextPhase()) {
					phaseTracker.updatePhase()
				}
				await phaseTracker?.saveCheckpoint()
				return
			}

			// User rejected move to next phase
			const shouldRetry = await config.sidebarController.task?.askUserApproval("ask_retry", PROMPTS.RETRY_PHASE_ASK)

			if (shouldRetry && phaseTracker?.canRetryCurrentPhase()) {
				// Retry the current phase
				await config.callbacks.say("text", `🔄 **Phase 재시도**\n\n현재 Phase를 다시 시작합니다.`)
				await config.sidebarController.task?.retryCurrentPhase()
			} else if (shouldRetry && !phaseTracker?.canRetryCurrentPhase()) {
				// Maximum retries reached, force next phase
				await config.callbacks.say(
					"text",
					`⚠️ **재시도 한계 초과**\n\n최대 재시도 횟수(${PHASE_RETRY_LIMIT}회)를 초과했습니다. 다음 Phase로 강제 이동합니다.`,
				)
				await config.sidebarController.task?.forceNextPhase()
			} else {
				// No retry, force next phase
				await config.sidebarController.task?.forceNextPhase()
			}
		}

		// we already sent completion_result says, an empty string asks relinquishes control over button and field
		// in case last command was interactive and in partial state, the UI is expecting an ask response. This ends the command ask response, freeing up the UI to proceed with the completion ask.
		if (config.messageState.getClineMessages().at(-1)?.ask === "command_output") {
			await config.callbacks.say("command_output", "")
		}

		if (!block.partial && config.focusChainSettings.enabled) {
			await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
		}

		let text: string | undefined
		let images: string[] | undefined
		let completionFiles: string[] | undefined
		await config.sidebarController.onPhaseCompleted()
		const phaseTracker = config.sidebarController.phaseTracker
		if (!config.taskState.phaseFinished) {
			await handleCompletionResult()
		}
		const completionAction = phaseTracker?.getPhaseCompletionAction()
		switch (completionAction) {
			case "all_complete":
				await handleAllPhasesComplete(phaseTracker)
				break
			case "partial_complete":
				await handlePartialPhasesComplete(phaseTracker)
				break
			default:
				await handleCompletionResult()
				break
		}

		const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
		if (commandResult) {
			if (typeof commandResult === "string") {
				toolResults.push({
					type: "text",
					text: commandResult,
				})
			} else if (Array.isArray(commandResult)) {
				toolResults.push(...commandResult)
			}
		}
		toolResults.push({
			type: "text",
			text: `The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.\n<feedback>\n${text}\n</feedback>`,
		})
		toolResults.push(...formatResponse.imageBlocks(images))

		let fileContentString = ""
		if (completionFiles && completionFiles.length > 0) {
			fileContentString = await processFilesIntoText(completionFiles)
		}

		// Return the tool results as a complex response
		return [
			{
				type: "text" as const,
				text: `[attempt_completion] Result:`,
			},
			...toolResults,
			...(fileContentString
				? [
						{
							type: "text" as const,
							text: fileContentString,
						},
					]
				: []),
		]
	}
}
