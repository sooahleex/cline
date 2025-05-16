// src/core/assistant-message/phase-tracker.ts
import { parsePhases, PhaseStatus, Phase } from "../assistant-message/index"
import { Controller } from '../controller'
import * as vscode from 'vscode'

interface SubtaskState {
  description: string
  completed: boolean
}

export interface PhaseState {
  id: number;
  prompt: string;
  subtasks: SubtaskState[];
  complete: boolean;
  // 👉  Phase 와 호환되도록 최소 필드 추가
  paths?: string[];
  status?: PhaseStatus;
  index?: number;
  phase_prompt?: string;
}

export class PhaseTracker {
  private phases: PhaseState[] = []
  private currentPhaseIndex = 0

  /**
   * @param originalPrompt 사용자 원본 프롬프트 (Plan Mode 에 넘길 내용)
   */
  constructor(
    private originalPrompt: string,
    private controller: Controller,
    private outputChannel: vscode.OutputChannel
  ) {
    // 1단계: Plan Mode 로 첫 Phase(Plan) 세팅
    this.phases.push({
        id: 1,
        prompt: originalPrompt,
        subtasks: [], // Plan phase엔 Subtask 없음
        complete: false })
  }

  /** Plan 단계가 끝난 뒤 호출해서 실제 실행 Phase 목록을 채웁니다. */
  public addPhasesFromPlan(parsedPhases: Phase[]): void {
    parsedPhases.forEach(p => {
      this.phases.push({
        id: p.index,
        prompt: p.phase_prompt,
        subtasks: p.subtasks.map(st => ({description: st.description, completed: false})),
        complete: false,
      })
    })
    this.outputChannel.appendLine(
      `PhaseTracker: ${parsedPhases.length} phases registered.`
    )
  }

  /** 특정 Subtask를 완료 표시 */
  public completeSubtask(subtaskIdx: number): void {
    const phase = this.phases[this.currentPhaseIndex]
    if (phase.subtasks[subtaskIdx]) {
      phase.subtasks[subtaskIdx].completed = true
      this.outputChannel.appendLine(
        `PhaseTracker: Phase ${phase.id} - Subtask #${subtaskIdx+1} 완료`
      )
    }
  }

  public markCurrentPhaseComplete(): void {
    const phase = this.phases[this.currentPhaseIndex]

    phase.subtasks.forEach((_, idx) => this.completeSubtask(idx));
    phase.complete = true;

    this.outputChannel.appendLine(
        `PhaseTracker: Phase ${phase.id} - ${phase.prompt} marked as completed`
    );
  }



  public get totalPhases(): number {
    return this.phases.length;
  }

  public getOriginalPrompt(): string {
    return this.originalPrompt;
  }

  /** 현 Phase 전체 Subtask가 다 끝났는지 */
  public isCurrentPhaseComplete(): boolean {
    const subs = this.currentSubtasks
    return subs.length > 0 && subs.every(s => s.completed)
  }
  /** 현 Phase의 Subtask 리스트 */
  public get currentSubtasks(): SubtaskState[] {
    return this.phases[this.currentPhaseIndex].subtasks
  }

  /** 지금까지 만들어진 모든 Phase 의 원본 prompt 배열 */
  public getAllPhasePrompts(): string[] {
    return this.phases.map(p => p.prompt)
  }

  /** 현재 Phase 정의 */
  public get currentPhase(): Phase {
    const p = this.phases[this.currentPhaseIndex];

    return {
        ...p,

        index: p.index ?? p.id,
        phase_prompt: p.phase_prompt ?? p.prompt,
        paths : p.paths ?? [],
        status : p.status ?? "pending",

        subtasks : p.subtasks.map(st => ({
        description : st.description,
        completed   : st.completed,
        // Phase 타입이 요구하는 필드. 없으면 'generic' 으로 설정
        type        : (st as any).type ?? "generic",
        })),
  };
  }

  /** 다음 Phase 가 남아 있는지 */
  public hasNextPhase(): boolean {
    return this.currentPhaseIndex < this.phases.length - 1
  }

  /** 전체 Phase 가 모두 완료되었는지 */
  public allPhasesCompleted(): boolean {
    return this.phases.every(p => p.complete)
  }

  /**
   * 직전 Phase 를 완료 처리하고, 다음 Phase 로 넘어가며
   * Controller 를 통해 새로운 Task 세션을 띄우고 Prompt 를 전송합니다.
   *
   * @param contextSummary (Optional) 직전 Phase 결과 요약
   * @returns 다음 Phase 에 넘긴 프롬프트, 더 이상 없으면 null
   */
  public async moveToNextPhase(contextSummary?: string): Promise<string | null> {
    // (1) 현재 Phase 완료 표시
    this.phases[this.currentPhaseIndex].complete = true

    // (2) 다음 Phase 인덱스
    this.currentPhaseIndex++
    if (this.currentPhaseIndex >= this.phases.length) {
      this.outputChannel.appendLine(`PhaseTracker: All phases completed.`)
      return null
    }

    const next = this.currentPhase

    // (3) 선택적으로, 요약을 포함한 새로운 Prompt 조합
    let nextPrompt = next.phase_prompt
    if (contextSummary) {
      nextPrompt = [
        `# 이전 단계 요약:`,
        contextSummary,
        ``,
        `# 새로운 단계 (${next.index}/${this.phases.length}):`,
        next.phase_prompt,
      ].join('\n')
    }

    // (4) Controller 를 통해 완전 새로운 Task 세션 시작
    this.outputChannel.appendLine(
      `PhaseTracker: Starting Phase ${next.index}: "${next.phase_prompt}"`
    )
    await this.controller.clearTask()
    await this.controller.postStateToWebview()
    // UI 상에서 “새 대화” 버튼 누른 것 처럼 보내기
    await this.controller.postMessageToWebview({
      type: 'action',
      action: 'chatButtonClicked',
    })
    // 실제 LLM 에 던질 메시지
    await this.controller.postMessageToWebview({
      type: 'invoke',
      invoke: 'sendMessage',
      text: nextPrompt,
    })

    return nextPrompt
  }
}
