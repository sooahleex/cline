export type HistoryItem = {
	id: string
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number

	size?: number
	shadowGitConfigWorkTree?: string
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean
	checkpointTrackerErrorMessage?: string

	// Planning session information
	planningSessionId?: string // Unique ID for the planning session
	phaseIndex?: number // Phase number within the session (1, 2, 3...)
	totalPhases?: number // Total number of phases in the session
}
