// src/core/assistant-message/phase-tracker.ts
import { Controller } from "../controller"
import * as vscode from "vscode"

export type PhaseStatus = "in-complete" | "approved"

export enum PhaseExecutionMode {
	Sequential,
	Parallel,
	Contional,
}

export interface Phase {
	index: number
	phase_prompt?: string
	title: string
	description?: string
	paths: string[]
	subtasks: Subtask[]
}

export interface Subtask {
	index: number
	description: string
	completed: boolean
}

export interface SubtaskState {
	index: number
	subtask: Subtask
	result?: string
	startTime?: number
	endTime?: number
}

export interface PhaseState {
	index: number
	origin_prompt?: string
	phase?: Phase
	subtasks: SubtaskState[]
	complete: boolean
	status: PhaseStatus | "in-progress" | "completed" | "skipped"
	startTime?: number
	endTime?: number
}

export interface PhaseResult {
	phaseId: number
	summary: string
	subtaskResults: Record<string, string>
	executionTime: number
}

export interface ParsedPlan {
	rawPlan: string
	phases: Phase[]
}

export function parsePhases(rawPlan: string): Phase[] {
	const planContent = rawPlan

	// Slice and push for each Phase header
	interface PhaseInfo {
		index: number
		phase_prompt: string
		title: string
		description: string
		paths: string[]
		subtasks: string[]
	}

	const phaseMatches: PhaseInfo[] = []
	const headerRegex = /^Phase\s*(\d+)\s*[:\-]\s*([^\r\n]+)/gim
	const matches = Array.from(planContent.matchAll(headerRegex))

	for (let i = 0; i < matches.length; i++) {
		const h = matches[i]
		const idx = parseInt(h[1], 10)
		const title = h[2].trim()

		// The block extends from right after this header until the start of the next header
		const start = (h.index ?? 0) + h[0].length
		// peek ahead to find the start index of the next header
		const end = i + 1 < matches.length ? (matches[i + 1].index ?? planContent.length) : planContent.length

		const block = planContent.slice(start, end).trim()
		// Parse description / paths / subtasks from the block
		const description = /-?\s*Description:\s*([^\r\n]+)/i.exec(block)?.[1].trim() || ""

		const pathsMatch = /-?\s*Paths:\s*([\s\S]*?)(?=(?:-?\s*Description:|-?\s*Subtasks:|$))/i.exec(block)
		const pathsText = pathsMatch ? pathsMatch[1] : ""
		const paths = pathsText
			.split(/\r?\n/)
			.map((l) => l.replace(/^[\s*•\-\s]+/, "").trim())
			.filter((l) => l.length > 0)

		const subtaskMatch = /-?\s*Subtasks:\s*([\s\S]*)/i.exec(block)
		const subtaskText = subtaskMatch ? subtaskMatch[1] : ""
		const subtasks = subtaskText
			.split(/\r?\n/)
			.map((l) => l.replace(/^[\s*•\-\s]+/, "").trim())
			.filter((l) => l.length > 0)

		phaseMatches.push({
			index: idx,
			phase_prompt: h[0].trim(),
			title: title,
			description: description,
			paths: paths,
			subtasks: subtasks,
		})
	}

	if (phaseMatches.length > 0) {
		return createPhasesFromMatches(phaseMatches)
	}
	return []
}

function createPhasesFromMatches(
	phaseMatches: {
		index: number
		phase_prompt: string
		title: string
		description: string
		paths: string[]
		subtasks: string[]
	}[],
): Phase[] {
	// Create phases from the numbered list descriptions
	const phases: Phase[] = phaseMatches.map((phaseMatch) => ({
		index: phaseMatch.index,
		phase_prompt: phaseMatch.phase_prompt,
		title: phaseMatch.title,
		description: phaseMatch.description,
		paths: phaseMatch.paths,
		subtasks: phaseMatch.subtasks.map((subtask, i) => ({
			index: i,
			description: subtask,
			completed: false,
		})),
	}))

	// // Extract tool uses to associate with phases and subtasks
	// const toolUseRegex = /<(write_to_file|execute_command|attempt_completion)>([\s\S]*?)<\/\1>/g
	// const toolUses: { type: string; content: string; index: number }[] = []
	// let match

	// while ((match = toolUseRegex.exec(raw)) !== null) {
	// 	const toolType = match[1]
	// 	const content = match[2].trim()
	// 	// Find which phase this tool use most likely belongs to
	// 	const phaseIndex = findPhaseForToolUse(match.index, raw, phases)
	// 	toolUses.push({ type: toolType, content, index: phaseIndex || 0 })
	// }

	// // Associate tool uses with phases based on position in the text
	// toolUses.forEach((toolUse) => {
	// 	if (toolUse.index > 0 && toolUse.index <= phases.length) {
	// 		const phase = phases[toolUse.index - 1]
	// 		// Add a subtask for this tool use if not already present
	// 		const hasMatchingSubtask = phase.subtasks.some(
	// 			(subtask) => subtask.type === toolUse.type || subtask.description.toLowerCase().includes(toolUse.type),
	// 		)

	// 		if (!hasMatchingSubtask) {
	// 			phase.subtasks.push({
	// 				description: `Perform ${toolUse.type} operation`,
	// 				type: toolUse.type,
	// 				completed: false,
	// 			})
	// 		}
	// 	}
	// })

	return phases
}

export function parsePlanFromOutput(raw: string): ParsedPlan {
	const planRegex = /^#{1,6}\s*Phase\s*Plan\s*[\r\n]+```[\r\n]?([\s\S]*?)```/im
	const planMatch = planRegex.exec(raw)
	if (!planMatch) {
		throw new Error("No Phase Plan section found in the input text")
	}

	const rawPlan = planMatch[1].trim()

	const phases = parsePhases(rawPlan)
	if (phases.length === 0) {
		throw new Error("No phases found in the Phase Plan content")
	}

	return { rawPlan, phases }
}

export function parseSubtasksFromOutput(msg: string): {
	id: number
	completed: boolean
	note: string
}[] {
	// 예시: <subtask id="0" status="done">…</subtask> 같은 태그를 뽑는다거나,
	// parseAssistantMessageV2(msg) 로 thinking/path 블록을 분류해도 됩니다.
	// 여기서는 더 구체적인 포맷에 맞춰 구현해주세요.
	return []
}

export class PhaseTracker {
	private phases: PhaseState[] = []
	private currentPhaseIndex = 0
	private phaseResults: PhaseResult[] = []
	private executionConfig: any
	private phaseExecutionMode: PhaseExecutionMode = PhaseExecutionMode.Sequential
	private checkpointEnabled: boolean = true
	private checkpointFrequency: "phase" | "subtask" | "never" = "phase"
	private phaseChangeListeners: ((
		phaseId: number,
		newStatus: PhaseStatus | "in-progress" | "completed" | "skipped",
	) => void)[] = []

	public rawPlanContent?: string

	constructor(
		private originalPrompt: string,
		private controller: Controller,
		private outputChannel: vscode.OutputChannel,
	) {
		// Step 1: Set up the first Phase (Plan) in Plan Mode
		this.phases.push({
			index: 0,
			origin_prompt: originalPrompt,
			subtasks: [],
			complete: false,
			status: "in-complete",
			startTime: Date.now(),
		})
	}

	// Called after the Plan phase is completed to populate the actual execution Phase list.
	public addPhasesFromPlan(parsedPhases: Phase[]): void {
		parsedPhases.forEach((p) => {
			this.phases.push({
				index: p.index,
				phase: p,
				subtasks: p.subtasks.map((st, i) => ({
					index: i,
					subtask: st,
				})),
				complete: false,
				status: "in-complete",
				startTime: Date.now(),
				endTime: undefined,
			})
		})
		this.outputChannel.appendLine(`PhaseTracker: ${parsedPhases.length} phases registered.`)
		this.saveCheckpoint().catch(() => {})
	}

	public completeSubtask(phaseId: number, subtaskId: number, result?: string): void {
		const phase = this.phases.find((p) => p.index === phaseId)
		if (!phase) {
			return
		}
		const st = phase.subtasks.find((s) => s.index === subtaskId)
		if (!st) {
			return
		}
		st.subtask.completed = true
		st.result = result
		st.endTime = Date.now()
		this.outputChannel.appendLine(`Subtask ${subtaskId} of Phase ${phaseId} completed.`)
		if (phase.subtasks.every((s) => s.subtask.completed)) {
			this.completePhase(phase.index)
		}
		if (this.checkpointEnabled && this.checkpointFrequency === "subtask") {
			this.saveCheckpoint()
		}
	}

	public markCurrentPhaseComplete(summary: string = "", thinking: string[] = []): void {
		const id = this.phases[this.currentPhaseIndex].index
		this.completePhase(id, summary, thinking)
	}

	private completePhase(phaseId: number, summary: string = "", thinking: string[] = []): void {
		const phase = this.phases.find((p) => p.index === phaseId)
		if (!phase) {
			return
		}
		phase.subtasks.forEach((st) => {
			if (!st.subtask.completed) {
				st.subtask.completed = true
			}
			st.endTime = st.endTime || Date.now()
		})
		phase.complete = true
		phase.status = "completed"
		phase.endTime = Date.now()
		const result: PhaseResult = {
			phaseId,
			summary,
			subtaskResults: phase.subtasks.reduce((acc, st) => ({ ...acc, [st.index]: st.result || "" }), {}),
			executionTime: (phase.endTime || Date.now()) - (phase.startTime || 0),
		}
		this.phaseResults.push(result)
		this.notifyPhaseChange(phaseId, "completed")
		if (this.checkpointEnabled && this.checkpointFrequency === "phase") {
			this.saveCheckpoint()
		}
		this.outputChannel.appendLine(`Phase ${phaseId} completed.`)
	}

	public hasNextPhase(): boolean {
		return this.currentPhaseIndex < this.phases.length - 1
	}

	public async moveToNextPhase(rawPlan?: string): Promise<string | null> {
		const current = this.phases[this.currentPhaseIndex]
		if (!current.complete) {
			this.completePhase(current.index, rawPlan || "", [])
		}
		this.currentPhaseIndex++
		if (this.currentPhaseIndex >= this.phases.length) {
			this.outputChannel.appendLine(`PhaseTracker: All phases completed.`)
			return null
		}
		const next = this.phases[this.currentPhaseIndex]
		next.status = "in-progress"
		next.startTime = Date.now()
		const prompt = rawPlan
			? [
					`# Whole Plan`,
					rawPlan,
					``,
					`# Current Phase (${next.index}/${this.phases.length}):`,
					next.phase?.phase_prompt,
				].join("\n")
			: next.phase?.phase_prompt

		if (!prompt) {
			this.outputChannel.appendLine(`PhaseTracker: No prompt available for Phase ${next.index}.`)
		}
		this.notifyPhaseChange(next.index, "in-progress")
		this.outputChannel.appendLine(`PhaseTracker: \Starting Phase ${next.index}: "${next.phase?.phase_prompt}"`)
		await this.controller.clearTask()
		await this.controller.postStateToWebview()
		await this.controller.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		await this.controller.postMessageToWebview({ type: "action", action: "focusChatInput", text: prompt })

		return prompt ?? null
	}

	public async executeAll(): Promise<void> {
		switch (this.phaseExecutionMode) {
			case PhaseExecutionMode.Sequential:
				await this.executeSequentially()
				break
			case PhaseExecutionMode.Parallel:
				await this.executeParallel()
				break
			case PhaseExecutionMode.Contional:
				await this.executeConditionally()
				break
		}
	}

	private async executeSequentially(): Promise<void> {
		while (this.hasNextPhase()) {
			await this.moveToNextPhase()
		}
	}

	private async executeParallel(): Promise<void> {
		const groups: number[][] = []
		const pending = new Set(this.phases.map((p) => p.index))
		while (pending.size) {
			const group: number[] = []
			for (const id of pending) {
				const phase = this.phases.find((p) => p.index === id)!
			}
			group.forEach((id) => pending.delete(id))
			await Promise.all(group.map((id) => this.completePhase(id)))
		}
	}

	private async executeConditionally(): Promise<void> {
		const { conditions = {}, defaultAction = "execute" } = this.executionConfig
		for (const phase of this.phases) {
			const should = conditions[phase.index] ? await conditions[phase.index]() : defaultAction === "execute"
			if (should) {
				await this.completePhase(phase.index)
			} else {
				phase.status = "skipped"
				phase.complete = true
				this.notifyPhaseChange(phase.index, "skipped")
			}
		}
	}

	public onPhaseChange(
		listener: (phaseId: number, status: PhaseStatus | "in-progress" | "completed" | "skipped") => void,
	): void {
		this.phaseChangeListeners.push(listener)
	}

	public get currentSubtasks(): SubtaskState[] {
		return this.phases[this.currentPhaseIndex].subtasks
	}

	public get currentPhase(): Phase {
		const p = this.phases[this.currentPhaseIndex]
		if (!p.phase) {
			throw new Error(`Phase ${p.index} is not properly initialized: missing phase data`)
		}
		return p.phase
	}

	public get totalPhases(): number {
		return this.phases.length
	}

	public isAllComplete(): boolean {
		return this.phases.every((p) => p.complete)
	}

	private notifyPhaseChange(id: number, status: PhaseStatus | "in-progress" | "completed" | "skipped"): void {
		this.phaseChangeListeners.forEach((l) => {
			try {
				l(id, status)
			} catch {}
		})
	}

	public getOriginalPrompt(): string {
		return this.originalPrompt
	}

	private async saveCheckpoint(): Promise<void> {
		try {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
			if (!workspaceFolder) {
				return
			}

			const checkpointData = {
				phases: this.phases,
				currentPhaseIndex: this.currentPhaseIndex,
				originalPrompt: this.originalPrompt,
			}

			const checkpointPath = vscode.Uri.joinPath(workspaceFolder.uri, ".cline", "phase-checkpoint.json")
			try {
				await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, ".cline"))
			} catch {}
			await vscode.workspace.fs.writeFile(
				checkpointPath,
				new Uint8Array(Buffer.from(JSON.stringify(checkpointData, null, 2))),
			)
		} catch (error) {
			this.outputChannel.appendLine(`Error saving phase checkpoint: ${error}`)
		}
	}

	/** Restore tracker progress from .cline/phase-checkpoint.json if present */
	public static async fromCheckpoint(
		controller: Controller,
		outputChannel: vscode.OutputChannel,
	): Promise<PhaseTracker | undefined> {
		try {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
			if (!workspaceFolder) {
				return undefined
			}

			const checkpointPath = vscode.Uri.joinPath(workspaceFolder.uri, ".cline", "phase-checkpoint.json")
			const data = await vscode.workspace.fs.readFile(checkpointPath)
			const checkpoint = JSON.parse(data.toString())
			const tracker = new PhaseTracker(checkpoint.originalPrompt, controller, outputChannel)
			tracker["phases"] = checkpoint.phases
			tracker["currentPhaseIndex"] = checkpoint.currentPhaseIndex
			return tracker
		} catch (error) {
			outputChannel.appendLine(`Error restoring phase checkpoint: ${error}`)
			return undefined
		}
	}
}
