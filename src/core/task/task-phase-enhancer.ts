import { PhaseTrackerAdapter } from '../assistant-message';
import { Task } from '../task';

/**
 * Task 클래스에서 ImprovedPhaseTracker 기능을 쉽게 사용할 수 있도록 도와주는 유틸리티 클래스
 */
export class TaskPhaseEnhancer {
    private task: Task;
    private phaseTrackerAdapter?: PhaseTrackerAdapter;

    constructor(task: Task) {
        this.task = task;
    }

    /**
     * Task로부터 PhaseTrackerAdapter 인스턴스를 가져오거나 생성
     */
    public getPhaseTrackerAdapter(): PhaseTrackerAdapter | undefined {
        if (this.phaseTrackerAdapter) {
            return this.phaseTrackerAdapter;
        }

        const tracker = this.task.getPhaseTracker?.();
        if (!tracker) {
            return undefined;
        }

        // Controller에서 이미 PhaseTrackerAdapter가 만들어졌다면 이를 사용
        if (this.task['sidebarController']['phaseTracker']) {
            const controllerTracker = this.task['sidebarController']['phaseTracker'] as PhaseTrackerAdapter;
            this.phaseTrackerAdapter = controllerTracker;
            return this.phaseTrackerAdapter;
        }

        // 없다면 새로 생성
        // (실제 구현에서는 이 케이스가 발생하지 않아야 함)
        return undefined;
    }

    /**
     * 현재 Phase에 아티팩트 파일 추가
     */
    public addArtifact(filePath: string): void {
        const adapter = this.getPhaseTrackerAdapter();
        if (adapter) {
            adapter.addArtifact(filePath);
        }
    }

    /**
     * 체크포인트 설정 변경
     */
    public configureCheckpointing(enabled: boolean, frequency: 'phase' | 'subtask' | 'never'): void {
        const adapter = this.getPhaseTrackerAdapter();
        if (adapter) {
            adapter.configureCheckpointing(enabled, frequency);
        }
    }

    /**
     * 실행 보고서 생성
     */
    public generatePhaseExecutionReport(): any {
        const adapter = this.getPhaseTrackerAdapter();
        if (adapter) {
            return adapter.generatePhaseExecutionReport();
        }
        return null;
    }

    /**
     * 특정 subtask 완료 표시
     */
    public completeSubtask(phaseId: number, subtaskId: string, result?: string): void {
        const adapter = this.getPhaseTrackerAdapter();
        if (adapter && adapter.getImprovedTracker) {
            adapter.getImprovedTracker().completeSubtask(phaseId, subtaskId, result);
        }
    }

    /**
     * 실행 모드 설정
     */
    public setExecutionMode(mode: any, config?: any): void {
        const adapter = this.getPhaseTrackerAdapter();
        if (adapter) {
            adapter.setExecutionMode(mode, config);
        }
    }
}
