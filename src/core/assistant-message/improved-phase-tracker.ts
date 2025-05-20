import * as vscode from 'vscode';
import { Controller } from '../controller';
import { PhaseStatus, Phase } from '../assistant-message/index';

/**
 * Represents a subtask within a phase
 */
export interface SubtaskState {
  id: string;
  description: string;
  completed: boolean;
  type: string;
  result?: string;
  startTime?: number;
  endTime?: number;
}

/**
 * Represents the state of a single phase
 */
export interface PhaseState {
  id: number;
  prompt: string;
  subtasks: SubtaskState[];
  complete: boolean;
  paths?: string[];
  status: PhaseStatus | string; // 확장된 상태값 허용
  index: number;
  phase_prompt: string;
  startTime?: number;
  endTime?: number;
  artifacts?: string[]; // Files or resources created during this phase
  dependencies?: number[]; // IDs of phases this phase depends on
}

/**
 * Results from a completed phase
 */
export interface PhaseResult {
  phaseId: number;
  summary: string;
  artifacts: string[];
  subtaskResults: Record<string, string>;
  executionTime: number;
}

/**
 * Extended phase status for internal use
 */
export type ExtendedPhaseStatus = PhaseStatus | "in-progress" | "completed" | "skipped";

/**
 * Phase execution modes
 */
export enum PhaseExecutionMode {
  Sequential, // Default: execute phases in order
  Parallel,   // Execute independent phases concurrently
  Conditional // Execute phases based on conditions
}

/**
 * Configuration for conditional phase execution
 */
export interface ConditionalExecutionConfig {
  conditions: Record<number, () => Promise<boolean>>;
  defaultAction: 'skip' | 'execute';
}

/**
 * Enhanced Phase Tracker with improved capabilities
 */
export class ImprovedPhaseTracker {
  private phases: PhaseState[] = [];
  private currentPhaseIndex = 0;
  private phaseResults: PhaseResult[] = [];
  private executionMode: PhaseExecutionMode = PhaseExecutionMode.Sequential;
  private executionConfig: any;
  private checkpointEnabled: boolean = true;
  private checkpointFrequency: 'phase' | 'subtask' | 'never' = 'phase';
  private phaseChangeListeners: ((phaseId: number, newStatus: ExtendedPhaseStatus) => void)[] = [];

  /**
   * Creates a new improved phase tracker
   * 
   * @param originalPrompt User's original prompt (to pass to Plan Mode)
   * @param controller Reference to the controller
   * @param outputChannel VS Code output channel for logging
   */
  constructor(
    private originalPrompt: string,
    private controller: Controller,
    private outputChannel: vscode.OutputChannel
  ) {
    // Initialize with a planning phase
    this.phases.push({
      id: 1,
      prompt: originalPrompt,
      subtasks: [], // Planning phase has no subtasks
      complete: false,
      status: "pending",
      index: 1,
      phase_prompt: originalPrompt,
      startTime: Date.now()
    });
  }

  /**
   * Add phases based on the plan generated
   */
  public addPhasesFromPlan(parsedPhases: Phase[]): void {
    parsedPhases.forEach(p => {
      this.phases.push({
        id: p.index,
        prompt: p.phase_prompt,
        subtasks: p.subtasks.map(st => ({
          id: `${p.index}-${p.subtasks.indexOf(st)}`,
          description: st.description, 
          completed: false,
          type: st.type || 'generic'
        })),
        complete: false,
        status: "pending",
        index: p.index,
        phase_prompt: p.phase_prompt,
        paths: p.paths || [],
        dependencies: [] // By default, phases depend on the previous phase
      });
    });
    
    // Set default phase dependencies (each phase depends on the previous one)
    for (let i = 2; i < this.phases.length; i++) {
      this.phases[i].dependencies = [i - 1];
    }
    
    this.outputChannel.appendLine(
      `ImprovedPhaseTracker: ${parsedPhases.length} phases registered.`
    );
  }

  /**
   * Set dependencies between phases
   */
  public setDependencies(phaseId: number, dependsOn: number[]): void {
    const phase = this.phases.find(p => p.id === phaseId);
    if (phase) {
      phase.dependencies = dependsOn;
    }
  }

  /**
   * Mark a specific subtask as completed
   */
  public completeSubtask(phaseId: number, subtaskId: string, result?: string): void {
    const phase = this.phases.find(p => p.id === phaseId);
    if (!phase) {
      return;
    }
    
    const subtask = phase.subtasks.find(s => s.id === subtaskId);
    if (subtask) {
      subtask.completed = true;
      subtask.result = result;
      subtask.endTime = Date.now();
      
      this.outputChannel.appendLine(
        `ImprovedPhaseTracker: Phase ${phaseId} - Subtask ${subtaskId} completed`
      );
      
      // Check if all subtasks are complete and auto-complete the phase if they are
      if (phase.subtasks.every(s => s.completed)) {
        this.completePhase(phaseId);
      }
      
      // Save checkpoint if configured for subtask frequency
      if (this.checkpointEnabled && this.checkpointFrequency === 'subtask') {
        this.saveCheckpoint();
      }
    }
  }

  /**
   * Mark the current phase as complete
   */
  public markCurrentPhaseComplete(summary?: string): void {
    this.completePhase(this.phases[this.currentPhaseIndex].id, summary);
  }

  /**
   * Complete a specific phase
   */
  public completePhase(phaseId: number, summary?: string): void {
    const phase = this.phases.find(p => p.id === phaseId);
    if (!phase) {
      return;
    }
    
    // Complete all subtasks
    phase.subtasks.forEach(st => {
      if (!st.completed) {
        st.completed = true;
        st.endTime = Date.now();
      }
    });
    
    // Mark phase as complete
    phase.complete = true;
    phase.status = "completed";
    phase.endTime = Date.now();
    
    // Collect results and store them
    const result: PhaseResult = {
      phaseId: phase.id,
      summary: summary || '',
      artifacts: phase.artifacts || [],
      subtaskResults: phase.subtasks.reduce((acc, st) => {
        acc[st.id] = st.result || '';
        return acc;
      }, {} as Record<string, string>),
      executionTime: (phase.endTime || Date.now()) - (phase.startTime || 0)
    };
    
    this.phaseResults.push(result);
    
    this.outputChannel.appendLine(
      `ImprovedPhaseTracker: Phase ${phase.id} - "${phase.prompt}" marked as completed`
    );
    
    // Notify listeners of phase change
    this.notifyPhaseChange(phase.id, "completed");
    
    // Save checkpoint if configured for phase frequency
    if (this.checkpointEnabled && this.checkpointFrequency === 'phase') {
      this.saveCheckpoint();
    }
  }

  /**
   * Add a file artifact to the current phase
   */
  public addArtifact(filePath: string): void {
    const phase = this.phases[this.currentPhaseIndex];
    if (!phase.artifacts) {
      phase.artifacts = [];
    }
    phase.artifacts.push(filePath);
  }

  /**
   * Subscribe to phase changes
   */
  public onPhaseChange(listener: (phaseId: number, newStatus: ExtendedPhaseStatus) => void): void {
    this.phaseChangeListeners.push(listener);
  }

  /**
   * Notify listeners of phase changes
   */
  private notifyPhaseChange(phaseId: number, newStatus: ExtendedPhaseStatus): void {
    this.phaseChangeListeners.forEach(listener => {
      try {
        listener(phaseId, newStatus);
      } catch (error) {
        this.outputChannel.appendLine(`Error in phase change listener: ${error}`);
      }
    });
  }

  /**
   * Notify all phase change listeners about a phase status change
   */
  private notifyPhaseChangeListeners(phaseId: number, newStatus: ExtendedPhaseStatus): void {
    this.phaseChangeListeners.forEach(listener => {
      try {
        listener(phaseId, newStatus);
      } catch (err) {
        this.outputChannel.appendLine(`Error in phase change listener: ${err}`);
      }
    });
  }

  /**
   * Configure the execution mode
   */
  public setExecutionMode(mode: PhaseExecutionMode, config?: any): void {
    this.executionMode = mode;
    this.executionConfig = config;
  }

  /**
   * Configure checkpointing
   */
  public configureCheckpointing(enabled: boolean, frequency: 'phase' | 'subtask' | 'never'): void {
    this.checkpointEnabled = enabled;
    this.checkpointFrequency = frequency;
  }

  /**
   * Get the total number of phases
   */
  public get totalPhases(): number {
    return this.phases.length;
  }

  /**
   * Get the original prompt
   */
  public getOriginalPrompt(): string {
    return this.originalPrompt;
  }

  /**
   * Check if current phase is complete
   */
  public isCurrentPhaseComplete(): boolean {
    const phase = this.phases[this.currentPhaseIndex];
    return phase.complete;
  }

  /**
   * Get subtasks for the current phase
   */
  public get currentSubtasks(): SubtaskState[] {
    return this.phases[this.currentPhaseIndex].subtasks;
  }

  /**
   * Get all phase prompts
   */
  public getAllPhasePrompts(): string[] {
    return this.phases.map(p => p.prompt);
  }

  /**
   * Get the current phase definition
   */
  public get currentPhase(): Phase {
    const p = this.phases[this.currentPhaseIndex];
    
    return {
      index: p.index,
      phase_prompt: p.phase_prompt,
      paths: p.paths || [],
      status: p.status as PhaseStatus,
      subtasks: p.subtasks.map(st => ({
        description: st.description,
        completed: st.completed,
        type: st.type,
      })),
    };
  }

  /**
   * Get the current phase state (internal use)
   */
  private get currentPhaseState(): PhaseState {
    return this.phases[this.currentPhaseIndex];
  }

  /**
   * Check if there's a next phase
   */
  public hasNextPhase(): boolean {
    return this.currentPhaseIndex < this.phases.length - 1;
  }

  /**
   * Check if all phases are completed
   */
  public allPhasesCompleted(): boolean {
    return this.phases.every(p => p.complete);
  }

  /**
   * Build the prompt for the next phase with context from previous phases
   */
  private buildNextPhasePrompt(contextSummary: string | undefined, next: Phase): string {
    if (!contextSummary) {
      return next.phase_prompt;
    }
    
    return [
      `# Previous Phase Summary:`,
      contextSummary,
      ``,
      `# Current Phase (${next.index}/${this.phases.length}):`,
      next.phase_prompt,
    ].join('\n');
  }

  /**
   * Move to the next phase
   */
  public async moveToNextPhase(contextSummary?: string): Promise<string | null> {
    // Mark current phase complete
    this.completePhase(this.phases[this.currentPhaseIndex].id, contextSummary);
    
    // Move to next phase
    this.currentPhaseIndex++;
    if (this.currentPhaseIndex >= this.phases.length) {
      this.outputChannel.appendLine(`ImprovedPhaseTracker: All phases completed.`);
      return null;
    }
    
    // Start the next phase
    const phaseState = this.phases[this.currentPhaseIndex];
    phaseState.status = "in-progress";
    phaseState.startTime = Date.now();
    
    const next = this.currentPhase;
    
    // Build next prompt with context
    const nextPrompt = this.buildNextPhasePrompt(contextSummary, next);
    
    // Notify listeners of phase change
    this.notifyPhaseChange(phaseState.id, "in-progress");
    
    // Start the next phase via the controller
    this.outputChannel.appendLine(
      `ImprovedPhaseTracker: Starting Phase ${phaseState.index}: "${phaseState.phase_prompt}"`
    );
    
    await this.controller.clearTask();
    await this.controller.postStateToWebview();
    
    // Simulate "New Chat" button click
    await this.controller.postMessageToWebview({
      type: 'action',
      action: 'chatButtonClicked',
    });
    
    // Send the actual message to the LLM
    await this.controller.postMessageToWebview({
      type: 'invoke',
      invoke: 'sendMessage',
      text: nextPrompt,
    });
    
    return nextPrompt;
  }

  /**
   * Execute all phases sequentially
   */
  public async executeSequentially(): Promise<void> {
    // Start from the current phase and execute each one in order
    while (this.currentPhaseIndex < this.phases.length) {
      const phaseState = this.phases[this.currentPhaseIndex];
      
      if (!phaseState.complete) {
        // Execute the current phase
        await this.executePhase(phaseState.id);
      }
      
      // Move to the next phase if not already at the end
      if (this.hasNextPhase()) {
        await this.moveToNextPhase();
      } else {
        break;
      }
    }
  }

  /**
   * Execute phases in parallel where possible
   */
  public async executeParallel(): Promise<void> {
    // Group phases by their dependencies
    const phaseGroups: number[][] = [];
    const remaining = new Set(this.phases.map(p => p.id));
    
    while (remaining.size > 0) {
      const group: number[] = [];
      
      // Find phases with no unmet dependencies
      for (const phaseId of remaining) {
        const phase = this.phases.find(p => p.id === phaseId)!;
        
        // Check if all dependencies are satisfied
        const dependenciesMet = !phase.dependencies || 
          phase.dependencies.length === 0 || 
          phase.dependencies.every(depId => {
            const dep = this.phases.find(p => p.id === depId);
            return dep && dep.complete;
          });
        
        if (dependenciesMet) {
          group.push(phaseId);
        }
      }
      
      if (group.length === 0) {
        this.outputChannel.appendLine(`Warning: Dependency cycle detected in phases`);
        break;
      }
      
      // Remove this group from remaining phases
      group.forEach(id => remaining.delete(id));
      
      // Add group to our execution plan
      phaseGroups.push(group);
    }
    
    // Execute each group
    for (const group of phaseGroups) {
      if (group.length === 1) {
        // For single phases, just execute normally
        await this.executePhase(group[0]);
      } else {
        // For multiple phases, execute them in parallel
        await Promise.all(group.map(phaseId => this.executePhase(phaseId)));
      }
    }
  }

  /**
   * Execute phases conditionally
   */
  public async executeConditionally(): Promise<void> {
    if (!this.executionConfig || 
        !(this.executionConfig as ConditionalExecutionConfig).conditions) {
      this.outputChannel.appendLine(`Error: Missing conditional execution configuration`);
      return;
    }
    
    const config = this.executionConfig as ConditionalExecutionConfig;
    
    // Execute phases based on conditions
    for (let i = this.currentPhaseIndex; i < this.phases.length; i++) {
      const phase = this.phases[i];
      
      // Check if there's a condition for this phase
      if (config.conditions[phase.id]) {
        const shouldExecute = await config.conditions[phase.id]();
        
        if (shouldExecute) {
          // Execute the phase
          await this.executePhase(phase.id);
        } else {
          // Skip the phase
          this.outputChannel.appendLine(`ImprovedPhaseTracker: Skipping Phase ${phase.id} based on condition`);
          phase.status = "skipped";
          phase.complete = true;
          this.notifyPhaseChange(phase.id, "skipped");
        }
      } else {
        // No condition specified, use default action
        if (config.defaultAction === 'execute') {
          await this.executePhase(phase.id);
        } else {
          this.outputChannel.appendLine(`ImprovedPhaseTracker: Skipping Phase ${phase.id} (default action)`);
          phase.status = "skipped";
          phase.complete = true;
          this.notifyPhaseChange(phase.id, "skipped");
        }
      }
    }
  }

  /**
   * Execute a specific phase
   */
  private async executePhase(phaseId: number): Promise<void> {
    const phase = this.phases.find(p => p.id === phaseId);
    if (!phase || phase.complete) {
      return;
    }
    
    // Set phase to in-progress status
    phase.status = "in-progress";
    phase.startTime = Date.now();
    this.notifyPhaseChange(phaseId, "in-progress");
    
    this.outputChannel.appendLine(`ImprovedPhaseTracker: Executing Phase ${phaseId}: "${phase.prompt}"`);
    
    // Since we can't directly execute in this example, we'll just mark it as completed
    // In a real implementation, you would use the controller to execute the phase
    // For demonstration purposes, we'll simulate completion after a delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    this.completePhase(phaseId);
  }

  /**
   * Get the execution time for a phase
   */
  public getPhaseExecutionTime(phaseId: number): number {
    const phase = this.phases.find(p => p.id === phaseId);
    if (!phase) {
      return 0;
    }
    
    const endTime = phase.endTime || Date.now();
    const startTime = phase.startTime || endTime;
    return endTime - startTime;
  }

  /**
   * Get the total execution time across all phases
   */
  public getTotalExecutionTime(): number {
    return this.phases.reduce((total, phase) => {
      return total + this.getPhaseExecutionTime(phase.id);
    }, 0);
  }

  /**
   * Generate a report on phase execution
   */
  public generatePhaseExecutionReport(): any {
    return {
      totalPhases: this.phases.length,
      completedPhases: this.phases.filter(p => p.complete).length,
      totalExecutionTime: this.getTotalExecutionTime(),
      phaseDetails: this.phases.map(p => ({
        id: p.id,
        prompt: p.prompt,
        status: p.status,
        executionTime: this.getPhaseExecutionTime(p.id),
        subtasks: p.subtasks.map(st => ({
          id: st.id,
          description: st.description,
          completed: st.completed,
          result: st.result
        })),
        artifacts: p.artifacts || []
      }))
    };
  }

  /**
   * Save the current state to a checkpoint
   */
  private async saveCheckpoint(): Promise<void> {
    try {
      const checkpointData = {
        phases: this.phases,
        currentPhaseIndex: this.currentPhaseIndex,
        phaseResults: this.phaseResults,
        originalPrompt: this.originalPrompt,
        executionMode: this.executionMode,
        executionConfig: this.executionConfig
      };
      
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return;
      }
      
      const checkpointPath = vscode.Uri.joinPath(workspaceFolder.uri, '.cline', 'phase-checkpoint.json');
      
      // Ensure directory exists
      try {
        await vscode.workspace.fs.createDirectory(
          vscode.Uri.joinPath(workspaceFolder.uri, '.cline')
        );
      } catch (error) {
        // Directory likely already exists
      }
      
      // Write checkpoint file
      await vscode.workspace.fs.writeFile(
        checkpointPath,
        new Uint8Array(Buffer.from(JSON.stringify(checkpointData, null, 2)))
      );
      
      this.outputChannel.appendLine(`ImprovedPhaseTracker: Checkpoint saved`);
    } catch (error) {
      this.outputChannel.appendLine(`Error saving checkpoint: ${error}`);
    }
  }

  /**
   * Restore from a checkpoint
   */
  public static async fromCheckpoint(
    controller: Controller,
    outputChannel: vscode.OutputChannel
  ): Promise<ImprovedPhaseTracker | undefined> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return undefined;
      }
      
      const checkpointPath = vscode.Uri.joinPath(workspaceFolder.uri, '.cline', 'phase-checkpoint.json');
      
      // Read checkpoint file
      const data = await vscode.workspace.fs.readFile(checkpointPath);
      const checkpoint = JSON.parse(data.toString());
      
      // Create new tracker with restored state
      const tracker = new ImprovedPhaseTracker(checkpoint.originalPrompt, controller, outputChannel);
      tracker.phases = checkpoint.phases;
      tracker.currentPhaseIndex = checkpoint.currentPhaseIndex;
      tracker.phaseResults = checkpoint.phaseResults;
      tracker.executionMode = checkpoint.executionMode;
      tracker.executionConfig = checkpoint.executionConfig;
      
      outputChannel.appendLine(`ImprovedPhaseTracker: Restored from checkpoint`);
      return tracker;
    } catch (error) {
      outputChannel.appendLine(`Error restoring from checkpoint: ${error}`);
      return undefined;
    }
  }

  /**
   * Force a phase to be completed even if checks failed
   * This is a fallback for cases where normal completion mechanisms fail
   */
  public forceCompleteCurrentPhase(summary?: string): void {
    const phase = this.phases[this.currentPhaseIndex];
    
    // Force all subtasks to be completed
    phase.subtasks.forEach(st => {
      st.completed = true;
      st.endTime = Date.now();
    });
    
    // Mark the phase as complete
    phase.complete = true;
    phase.status = "completed";
    phase.endTime = Date.now();
    
    this.outputChannel.appendLine(`Force-completed phase ${phase.id}: ${phase.prompt}`);
    
    // Notify phase change listeners
    this.notifyPhaseChangeListeners(phase.id, "completed");
    
    // Add to results if summary is provided
    if (summary) {
      this.phaseResults.push({
        phaseId: phase.id,
        summary: summary,
        artifacts: phase.artifacts || [],
        subtaskResults: phase.subtasks.reduce((acc, st) => {
          acc[st.id] = st.result || `Completed ${st.description}`;
          return acc;
        }, {} as Record<string, string>),
        executionTime: phase.endTime! - (phase.startTime || 0)
      });
    }
  }
}
