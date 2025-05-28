// src/core/assistant-message/phase-tracker.ts
import { parsePhases, PhaseStatus, Phase } from "../assistant-message/index"
import { Controller } from "../controller"
import * as vscode from "vscode"

export enum PhaseExecutionMode {
	Sequential,
	Parallel,
	Contional,
}

export interface SubtaskState {
	id: string
	description: string
	completed: boolean
	type: string
	result?: string
	startTime?: number
	endTime?: number
}

export interface PhaseState {
	id: number
	prompt: string
	phase_prompt: string
	subtasks: SubtaskState[]
	complete: boolean
	status: PhaseStatus | "in-progress" | "completed" | "skipped"
	index: number
	paths: string[]
	thinking: string[]
	artifacts: string[]
	dependencies: number[]
	startTime?: number
	endTime?: number
}

export interface PhaseResult {
	phaseId: number
	summary: string
	thinking: string[]
	artifacts: string[]
	subtaskResults: Record<string, string>
	executionTime: number
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

	constructor(
		private originalPrompt: string,
		private controller: Controller,
		private outputChannel: vscode.OutputChannel,
	) {
		// 1단계: Plan Mode 로 첫 Phase(Plan) 세팅
		this.phases.push({
			id: 1,
			prompt: originalPrompt,
			phase_prompt: originalPrompt,
			subtasks: [],
			complete: false,
			status: "pending",
			index: 1,
			paths: [],
			thinking: [],
			artifacts: [],
			dependencies: [],
			startTime: Date.now(),
		})
	}

	/** Plan 단계가 끝난 뒤 호출해서 실제 실행 Phase 목록을 채웁니다. */
	public addPhasesFromPlan(parsedPhases: Phase[]): void {
		parsedPhases.forEach((p) => {
			this.phases.push({
				id: p.index,
				prompt: p.phase_prompt,
				phase_prompt: p.phase_prompt,
				subtasks: p.subtasks.map((st, i) => ({
					id: `${p.index}-${i}`,
					description: st.description,
					completed: false,
					type: st.type || "generic",
				})),
				complete: false,
				status: "pending",
				index: p.index,
				paths: p.paths || [],
				thinking: [],
				artifacts: [],
				dependencies: [p.index - 1].filter((x) => x > 0) || [],
				startTime: Date.now(),
				endTime: undefined,
			})
		})
		this.outputChannel.appendLine(`PhaseTracker: ${parsedPhases.length} phases registered.`)
		this.saveCheckpoint().catch(() => {})
	}

	public completeSubtask(phaseId: number, subtaskId: string, result?: string): void {
		const phase = this.phases.find((p) => p.id === phaseId)
		if (!phase) {
			return
		}
		const st = phase.subtasks.find((s) => s.id === subtaskId)
		if (!st) {
			return
		}
		st.completed = true
		st.result = result
		st.endTime = Date.now()
		this.outputChannel.appendLine(`Subtask ${subtaskId} of Phase ${phaseId} completed.`)
		if (phase.subtasks.every((s) => s.completed)) {
			this.completePhase(phase.id)
		}
		if (this.checkpointEnabled && this.checkpointFrequency === "subtask") {
			this.saveCheckpoint()
		}
	}

	public markCurrentPhaseComplete(summary: string = "", thinking: string[] = []): void {
		const id = this.phases[this.currentPhaseIndex].id
		this.completePhase(id, summary, thinking)
	}

	private completePhase(phaseId: number, summary: string = "", thinking: string[] = []): void {
		const phase = this.phases.find((p) => p.id === phaseId)
		if (!phase) {
			return
		}
		phase.subtasks.forEach((st) => {
			if (!st.completed) {
				st.completed = true
			}
			st.endTime = st.endTime || Date.now()
		})
		phase.complete = true
		phase.status = "completed"
		phase.endTime = Date.now()
		phase.thinking.push(...thinking)
		const result: PhaseResult = {
			phaseId,
			summary,
			thinking: phase.thinking || [],
			artifacts: phase.artifacts || [],
			subtaskResults: phase.subtasks.reduce((acc, st) => ({ ...acc, [st.id]: st.result || "" }), {}),
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

	public async moveToNextPhase(contextSummary?: string): Promise<string | null> {
		const current = this.phases[this.currentPhaseIndex]
		if (!current.complete) {
			this.completePhase(current.id, contextSummary || "", [])
		}
		this.currentPhaseIndex++
		if (this.currentPhaseIndex >= this.phases.length) {
			this.outputChannel.appendLine(`PhaseTracker: All phases completed.`)
			return null
		}
		const next = this.phases[this.currentPhaseIndex]
		next.status = "in-progress"
		next.startTime = Date.now()
		const prompt = contextSummary
			? [
					`# Previous Phase Summary:`,
					contextSummary,
					``,
					`# Current Phase (${next.index}/${this.phases.length}):`,
					next.phase_prompt,
				].join("\n")
			: next.phase_prompt
		this.notifyPhaseChange(next.id, "in-progress")
		this.outputChannel.appendLine(`PhaseTracker: \Starting Phase ${next.index}: "${next.phase_prompt}"`)
		await this.controller.clearTask()
		await this.controller.postStateToWebview()
		await this.controller.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		await this.controller.postMessageToWebview({ type: "action", action: "focusChatInput", text: prompt })

		return prompt
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
		const pending = new Set(this.phases.map((p) => p.id))
		while (pending.size) {
			const group: number[] = []
			for (const id of pending) {
				const phase = this.phases.find((p) => p.id === id)!
				const depsMet = phase.dependencies.every((d) => this.phases.find((p) => p.id === d)!.complete)
				if (depsMet) {
					group.push(id)
				}
			}
			group.forEach((id) => pending.delete(id))
			await Promise.all(group.map((id) => this.completePhase(id)))
		}
	}

	private async executeConditionally(): Promise<void> {
		const { conditions = {}, defaultAction = "execute" } = this.executionConfig
		for (const phase of this.phases) {
			const should = conditions[phase.id] ? await conditions[phase.id]() : defaultAction === "execute"
			if (should) {
				await this.completePhase(phase.id)
			} else {
				phase.status = "skipped"
				phase.complete = true
				this.notifyPhaseChange(phase.id, "skipped")
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
		return {
			index: p.index,
			phase_prompt: p.phase_prompt,
			paths: p.paths,
			status: p.status as PhaseStatus,
			subtasks: p.subtasks.map((s) => ({ description: s.description, completed: s.completed, type: s.type })),
		}
	}

	public get totalPhases(): number {
		return this.phases.length
	}

	public allPhasesCompleted(): boolean {
		return this.phases.every((p) => p.complete)
	}

	public getAllPhasePrompts(): string[] {
		return this.phases.map((p) => p.prompt)
	}

	public getThinking(phaseId: number): string[] {
		return this.phases.find((p) => p.id === phaseId)?.thinking || []
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
