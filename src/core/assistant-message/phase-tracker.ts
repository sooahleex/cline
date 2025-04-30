import { Phase, parsePhases } from "./index"

export class PhaseTracker {
	private phases: Phase[]
	private currentIndex = 0 // 0-based 인덱스
	private apiInstance: any // 여러분이 쓰시는 API 클라이언트 타입으로 교체

	constructor(
		private assistantMessage: string,
		private originalPrompt: string,
	) {
		this.phases = parsePhases(assistantMessage)
	}

	/** 전체 Phase 수 */
	public get totalPhases(): number {
		return this.phases.length
	}

	/** 현재 진행 중인 Phase (1-based index) */
	public get currentPhase(): Phase | null {
		return this.phases[this.currentIndex] ?? null
	}

	/** 다음 Phase가 남아 있는지 */
	public hasNextPhase(): boolean {
		return this.currentIndex < this.phases.length
	}

	/** 현재 Phase를 승인 처리 */
	public approveCurrentPhase(): Phase | null {
		const phase = this.currentPhase
		if (phase) {
			phase.status = "approved"
		}
		return phase
	}

	/**
	 * Phase API를 시작
	 * (사용하시는 서버나 클라이언트를 여기서 띄우면 됩니다)
	 */
	private startApiForPhase(phase: Phase) {
		// 예시: this.apiInstance = new YourApiClient(…phase.paths…)
		console.log(`▶ Starting API for Phase ${phase.index}`)
	}

	/**
	 * Phase API를 종료
	 */
	private stopApi() {
		if (this.apiInstance) {
			// 예시: this.apiInstance.close()
			console.log(`■ Stopping current API`)
			this.apiInstance = null
		}
	}

	/**
	 * 다음 Phase로 넘어가면서:
	 * 1) 이전 Phase API 종료
	 * 2) currentIndex 증가
	 * 3) 새로운 Phase API 시작
	 * 4) LLM에 보낼 Prompt 문자열 반환
	 */
	public moveToNextPhase(): string | null {
		// 아직 남은 Phase가 없다면 null
		if (!this.hasNextPhase()) return null

		// (1) 이전 API 종료
		if (this.apiInstance) {
			this.stopApi()
		}

		// (2) 다음 Phase 선택
		const phase = this.phases[this.currentIndex]
		this.currentIndex += 1

		// (3) 새로운 Phase API 시작
		this.startApiForPhase(phase)

		// (4) LLM으로 보낼 Prompt 생성
		const promptPayload = {
			originalPrompt: this.originalPrompt,
			phaseIndex: phase.index,
			totalPhases: this.totalPhases,
			thinking: phase.thinking,
			paths: phase.paths,
		}

		const nextPrompt =
			`You are starting phase ${phase.index}/${this.totalPhases}:\n` +
			`Thinking: ${phase.thinking}\n` +
			`Paths: ${phase.paths.join(", ")}\n\n` +
			`Also include the original user prompt:\n${this.originalPrompt}\n`

		return nextPrompt
	}
}
