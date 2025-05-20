import * as vscode from 'vscode';
import { PhaseTracker } from './phase-tracker';
import { ImprovedPhaseTracker } from './improved-phase-tracker';
import { Phase } from './index';
import { Controller } from '../controller';

/**
 * PhaseTrackerAdapter는 기존 PhaseTracker와 새로운 ImprovedPhaseTracker 사이의 
 * 호환성을 보장하기 위한 어댑터 클래스입니다.
 * 
 * 이 어댑터는 기존 코드베이스에서 사용되는 메서드들이 ImprovedPhaseTracker에서도
 * 동일하게 작동하도록 보장하면서도, 점진적으로 새로운 기능을 도입할 수 있게 합니다.
 */
export class PhaseTrackerAdapter {
  private legacyTracker: PhaseTracker;
  private improvedTracker: ImprovedPhaseTracker;
  private useImproved: boolean;
  private outputChannel: vscode.OutputChannel;

  constructor(
    originalPrompt: string,
    controller: Controller,
    outputChannel: vscode.OutputChannel,
    useImproved: boolean = true
  ) {
    this.legacyTracker = new PhaseTracker(originalPrompt, controller, outputChannel);
    this.improvedTracker = new ImprovedPhaseTracker(originalPrompt, controller, outputChannel);
    this.useImproved = useImproved;
    this.outputChannel = outputChannel;
  }

  /**
   * Plan 단계가 끝난 뒤 호출해서 실제 실행 Phase 목록을 채웁니다.
   */
  public addPhasesFromPlan(parsedPhases: Phase[]): void {
    this.legacyTracker.addPhasesFromPlan(parsedPhases);
    this.improvedTracker.addPhasesFromPlan(parsedPhases);
  }

  /**
   * 특정 Subtask를 완료 표시
   */
  public completeSubtask(subtaskIdx: number): void {
    this.legacyTracker.completeSubtask(subtaskIdx);
    
    // ImprovedPhaseTracker에서는 phase ID와 subtask ID가 필요합니다
    const currentPhase = this.improvedTracker.currentPhase;
    if (currentPhase.subtasks[subtaskIdx]) {
      const subtaskId = `${currentPhase.index}-${subtaskIdx}`;
      this.improvedTracker.completeSubtask(currentPhase.index, subtaskId);
    }
  }  /**
   * 현재 Phase를 완료 표시
   */
  public markCurrentPhaseComplete(summary?: string): void {
    this.legacyTracker.markCurrentPhaseComplete();
    this.improvedTracker.markCurrentPhaseComplete(summary);
    
    // Ensure subtasks are also completed
    const subtasks = this.currentSubtasks;
    for (let i = 0; i < subtasks.length; i++) {
      if (!subtasks[i].completed) {
        this.completeSubtask(i);
      }
    }
    
    // Verify that the phase is actually marked as complete
    if (!this.improvedTracker.isCurrentPhaseComplete()) {
      this.outputChannel?.appendLine("Warning: Phase was not properly marked as complete. Forcing complete status.");
      // Force complete status
      if (this.useImproved) {
        this.improvedTracker.forceCompleteCurrentPhase(summary || "Phase forcibly completed");
      } else {
        this.legacyTracker.markCurrentPhaseComplete();
      }
    }
  }

  /**
   * 전체 Phase 수
   */
  public get totalPhases(): number {
    return this.useImproved ? 
      this.improvedTracker.totalPhases : 
      this.legacyTracker.totalPhases;
  }

  /**
   * 원본 프롬프트 반환
   */
  public getOriginalPrompt(): string {
    return this.useImproved ? 
      this.improvedTracker.getOriginalPrompt() : 
      this.legacyTracker.getOriginalPrompt();
  }

  /**
   * 현 Phase 전체 Subtask가 다 끝났는지
   */
  public isCurrentPhaseComplete(): boolean {
    return this.useImproved ? 
      this.improvedTracker.isCurrentPhaseComplete() : 
      this.legacyTracker.isCurrentPhaseComplete();
  }

  /**
   * 현 Phase의 Subtask 리스트
   */
  public get currentSubtasks() {
    return this.useImproved ? 
      this.improvedTracker.currentSubtasks : 
      this.legacyTracker.currentSubtasks;
  }

  /**
   * 모든 Phase의 프롬프트 배열
   */
  public getAllPhasePrompts(): string[] {
    return this.useImproved ? 
      this.improvedTracker.getAllPhasePrompts() : 
      this.legacyTracker.getAllPhasePrompts();
  }

  /**
   * 현재 Phase 정의
   */
  public get currentPhase(): Phase {
    return this.useImproved ? 
      this.improvedTracker.currentPhase : 
      this.legacyTracker.currentPhase;
  }

  /**
   * 다음 Phase가 남아 있는지
   */
  public hasNextPhase(): boolean {
    return this.useImproved ? 
      this.improvedTracker.hasNextPhase() : 
      this.legacyTracker.hasNextPhase();
  }

  /**
   * 전체 Phase가 모두 완료되었는지
   */
  public allPhasesCompleted(): boolean {
    return this.useImproved ? 
      this.improvedTracker.allPhasesCompleted() : 
      this.legacyTracker.allPhasesCompleted();
  }

  /**
   * 다음 Phase로 이동
   */
  public async moveToNextPhase(contextSummary?: string): Promise<string | null> {
    if (this.useImproved) {
      return this.improvedTracker.moveToNextPhase(contextSummary);
    } else {
      return this.legacyTracker.moveToNextPhase(contextSummary);
    }
  }

  /**
   * ImprovedPhaseTracker의 새 기능: 아티팩트 추가
   */
  public addArtifact(filePath: string): void {
    this.improvedTracker.addArtifact(filePath);
  }

  /**
   * ImprovedPhaseTracker의 새 기능: 체크포인트 설정
   */
  public configureCheckpointing(enabled: boolean, frequency: 'phase' | 'subtask' | 'never'): void {
    this.improvedTracker.configureCheckpointing(enabled, frequency);
  }

  /**
   * ImprovedPhaseTracker의 새 기능: 실행 모드 설정
   */
  public setExecutionMode(mode: any, config?: any): void {
    this.improvedTracker.setExecutionMode(mode, config);
  }

  /**
   * ImprovedPhaseTracker의 새 기능: 보고서 생성
   */
  public generatePhaseExecutionReport(): any {
    return this.improvedTracker.generatePhaseExecutionReport();
  }

  /**
   * 실제 사용할 트래커 선택하기
   */
  public selectImprovedTracker(useImproved: boolean): void {
    this.useImproved = useImproved;
  }

  /**
   * 내부 트래커들 직접 접근
   */
  public getLegacyTracker(): PhaseTracker {
    return this.legacyTracker;
  }

  public getImprovedTracker(): ImprovedPhaseTracker {
    return this.improvedTracker;
  }
}
