import * as vscode from "vscode"
import { Task } from "../task"
import { PhaseTrackerAdapter } from "../assistant-message/phase-tracker-adapter"

/**
 * Handles task completion and phase transitions
 */
export async function handleTaskCompleted(
	task: Task,
	resultSummary: string,
	phaseTracker: any,
	outputChannel: vscode.OutputChannel,
	resetPhaseTracker: () => void,
): Promise<void> {
	// this is called when the task is completed, so we can do any cleanup or finalization here
	const tracker = task.getPhaseTracker?.() || phaseTracker
	if (!tracker) {
		return
	}

	// Check if all phases are completed
	if (tracker.allPhasesCompleted()) {
		outputChannel.appendLine("[Controller] All phases are completed. Task finished.")
		vscode.window.showInformationMessage("🎉 All phases finished!")
		resetPhaseTracker() // reset phase tracker
		return
	}

	// If current phase is not yet marked as complete, do it now
	if (!tracker.isCurrentPhaseComplete()) {
		outputChannel.appendLine("[Controller] Marking current phase as complete.")
		tracker.markCurrentPhaseComplete(resultSummary)
	}

	// If there are more phases, move to the next one
	if (tracker.hasNextPhase()) {
		outputChannel.appendLine("[Controller] Moving to next phase.")
		await tracker
			.moveToNextPhase(resultSummary)
			.catch((err: unknown) => outputChannel.appendLine(`Error moving to next phase: ${err}`))
	} else {
		// We have no next phase but not all phases are marked as complete
		// This could happen if phases were not marked as complete correctly
		outputChannel.appendLine("Warning: No next phase available but not all phases are marked as completed.")

		// Force all phases to be marked as complete
		try {
			// Check if the tracker is a PhaseTrackerAdapter
			if ("getAllPhasePrompts" in tracker) {
				const adapter = tracker as PhaseTrackerAdapter
				const phases = adapter.getAllPhasePrompts()
				for (let i = 0; i < phases.length; i++) {
					// Try to make sure all phases are completed
					if (!tracker.allPhasesCompleted()) {
						tracker.markCurrentPhaseComplete(`Phase ${i + 1}/${phases.length} completed.`)
						if (tracker.hasNextPhase()) {
							await tracker.moveToNextPhase(resultSummary)
						}
					}
				}
			}
		} catch (error) {
			outputChannel.appendLine(`Error while trying to complete all phases: ${error}`)
		}

		vscode.window.showInformationMessage("🎉 All phases finished!")
		resetPhaseTracker() // reset phase tracker
	}

	console.log("[Controller] Phase processing complete. Result: \n", resultSummary)
}
