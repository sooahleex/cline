import { Phase, parsePhases, Subtask, ToolUseName } from "./index"
import * as vscode from 'vscode'; // vscode.OutputChannel 타입을 위해 추가
import { Controller } from '../controller'; // Controller 타입을 위해 추가 (실제 경로에 맞게 수정 필요)

// Define an interface for the API client
export interface ApiClient {
    initialize(paths: string[]): void;
    close(): void;
    executeCommand(command: string): Promise<string>;
    writeToFile(path: string, content: string): Promise<void>;
    readFile(path: string): Promise<string>;
    executeToolUse(toolName: ToolUseName, params: Record<string, string>): Promise<any>;
}

export class PhaseTracker {
    private phases: Phase[]
    private currentIndex = 0 // 0-based 인덱스
    private apiInstance: ApiClient | null = null
    private sidebarController: Controller | undefined; // sidebarController 추가
    private outputChannel: vscode.OutputChannel | undefined; // outputChannel 추가

    constructor(
        private assistantMessage: string,
        private originalPrompt: string,
        private apiClientFactory?: (paths: string[]) => ApiClient,
        sidebarController?: Controller, // sidebarController 주입
        outputChannel?: vscode.OutputChannel // outputChannel 주입
    ) {
        this.phases = parsePhases(assistantMessage);
        this.sidebarController = sidebarController;
        this.outputChannel = outputChannel;
    }

    /** 전체 Phase 수 */
    public get totalPhases(): number {
        return this.phases.length
    }

    /** 현재 진행 중인 Phase (1-based index) */
    public get currentPhase(): Phase | null {
        return this.phases[this.currentIndex] ?? null
    }

    /** 현재 Phase의 subtasks */
    public get currentSubtasks(): Subtask[] {
        return this.currentPhase?.subtasks || []
    }

    /** 모든 phase의 “raw prompt” 문자열을 배열로 돌려줍니다. */
    public getAllPhasePrompts(): string[] {
        return this.phases.map((p) => p.phase_prompt);
    }

    /** 현재 Phase 완료 상태 (모든 subtask가 완료되었는지) */
    public get isCurrentPhaseComplete(): boolean {
        const phase = this.currentPhase
        if (!phase || phase.subtasks.length === 0) {return false};
        return phase.subtasks.every(subtask => subtask.completed)
    }

    /** 다음 Phase가 남아 있는지 */
    public hasNextPhase(): boolean {
        return this.currentIndex < this.phases.length - 1
    }

    /** 현재 Phase를 승인 처리 */
    public approveCurrentPhase(): Phase | null {
        const phase = this.currentPhase
        if (phase) {
            phase.status = "approved"
        }
        return phase
    }

    /** 현재 Phase의 특정 subtask 완료 처리 */
    public completeSubtask(subtaskIndex: number): Subtask | null {
        const phase = this.currentPhase
        if (!phase || !phase.subtasks[subtaskIndex]) {return null};
        
        const subtask = phase.subtasks[subtaskIndex]
        subtask.completed = true
        return subtask
    }

    /**
     * Phase API를 시작
     * (사용하시는 서버나 클라이언트를 여기서 띄우면 됩니다)
     */
    private startApiForPhase(phase: Phase) {
        if (!this.apiClientFactory) {
            console.log(`▶ Starting API for Phase ${phase.index} (simulation mode)`)
            return;
        }
        
        // Create a new API client instance for this phase
        this.apiInstance = this.apiClientFactory(phase.paths);
        console.log(`▶ Started API for Phase ${phase.index} with paths: ${phase.paths.join(', ')}`)
    }

    /**
     * Phase API를 종료
     */
    private stopApi() {
        if (this.apiInstance) {
            this.apiInstance.close();
            console.log(`■ Stopping current API`)
            this.apiInstance = null
        }
    }

    /**
     * Execute a specific tool command through the API client
     * @param toolName The name of the tool to execute
     * @param params Parameters for the tool execution
     */
    public async executeToolCommand(toolName: ToolUseName, params: Record<string, string>): Promise<any> {
        if (!this.apiInstance) {
            throw new Error("No API client initialized for the current phase");
        }
        
        return this.apiInstance.executeToolUse(toolName, params);
    }

    /**
     * Executes a new task command
     * @param taskDescription Description of the new task
     * @param context Additional context for the task
     */
    public async executeNewTask(taskDescription: string, context?: string): Promise<any> {
        return this.executeToolCommand("new_task", {
            description: taskDescription,
            context: context || ""
        });
    }

    /**
     * 다음 Phase로 넘어가면서:
     * 1) 이전 Phase API 종료
     * 2) currentIndex 증가
     * 3) 새로운 Phase API 시작
     * 4) LLM에 보낼 Prompt 문자열 반환
     */
    public async moveToNextPhase(): Promise<string | null> {
        // 아직 남은 Phase가 없다면 null
        if (!this.hasNextPhase()) {return null};

        // (1) 이전 API 종료
        if (this.apiInstance) {
            this.stopApi()
        }

        // (2) 다음 Phase 선택
        this.currentIndex += 1
        const phase = this.phases[this.currentIndex]

        // (3) 새로운 Phase API 시작
        this.startApiForPhase(phase)

        // Generate a detailed prompt based on phase information
        const nextPrompt = [
            `You are starting phase ${phase.index}/${this.totalPhases}:`,
            `Phase description: ${phase.phase_prompt}`,
            `Paths: ${phase.paths.join(", ")}`,
            `Subtasks:`,
            ...phase.subtasks.map((st, i) => `  ${i+1}. ${st.description}`),
            ``,
            `Original user request:`,
            this.originalPrompt,
        ].join("\n");
        
        // (4) 새로운 Task를 시작하여 새 phase 작업 시작 (startNewTask 로직 통합)
        if (this.sidebarController && this.outputChannel) {
            try {
                this.outputChannel.appendLine(`Starting new phase task: ${phase.phase_prompt}`);
                await this.sidebarController.clearTask();
                await this.sidebarController.postStateToWebview();
                await this.sidebarController.postMessageToWebview({
                    type: "action",
                    action: "chatButtonClicked", // 새 작업 시작을 위한 UI 인터랙션
                });
                await this.sidebarController.postMessageToWebview({
                    type: "invoke",
                    invoke: "sendMessage", // 새 메시지(Phase 프롬프트) 전송
                    text: nextPrompt, // Phase 프롬프트를 새 작업의 내용으로 사용
                    // images: undefined, // 필요시 이미지 추가
                });
                this.outputChannel.appendLine(
                    `Phase ${phase.index} task started with prompt: "${phase.phase_prompt}"`
                );
                console.log(`Started new task for Phase ${phase.index} using sidebarController`);
            } catch (error) {
                console.error(`Failed to start new task for Phase ${phase.index}:`, error);
                if (this.outputChannel) {
                    this.outputChannel.appendLine(`Error starting phase ${phase.index} task: ${error}`);
                }
            }
        } else {
            console.log(`Skipping new task for Phase ${phase.index} due to missing sidebarController or outputChannel (simulation mode or test environment). Prompt:\n${nextPrompt}`);
        }

        return nextPrompt; // 프롬프트는 여전히 반환 (호출 측에서 필요할 수 있음)
    }
    
    /**
     * 특정 인덱스의 Phase로 직접 이동
     * @param index 이동할 Phase의 0-based 인덱스
     */
    public moveToPhase(index: number): string | null {
        if (index < 0 || index >= this.phases.length) {return null};
        
        // 현재 진행 중인 API를 종료
        if (this.apiInstance) {
            this.stopApi()
        }
        
        // 특정 Phase를 선택
        this.currentIndex = index
        const phase = this.phases[index]
        
        // 새로운 Phase API 시작
        this.startApiForPhase(phase)
        
        //TODO
        // Prompt 생성 로직
        const nextPrompt =
            `You are starting phase ${phase.index}/${this.totalPhases}:\n` +
            `Phase: ${phase.phase_prompt}\n` +
            `Paths: ${phase.paths.join(", ")}\n\n` +
            `This phase includes the following subtasks:\n` +
            phase.subtasks.map((st, i) => `${i+1}. ${st.description}`).join("\n") + "\n\n" +
            `Original request from user:\n${this.originalPrompt}\n`
            
        return nextPrompt
    }
}
