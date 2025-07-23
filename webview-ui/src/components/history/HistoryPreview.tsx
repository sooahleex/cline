import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatLargeNumber } from "@/utils/format"
import { StringRequest } from "@shared/proto/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo, useState, useMemo, useCallback } from "react"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const extensionStateContext = useExtensionState()
	const { taskHistory } = extensionStateContext
	const [isExpanded, setIsExpanded] = useState(true)

	// Keep track of collapsed planning sessions in preview
	const [collapsedSessions, setCollapsedSessions] = useState<Set<string>>(new Set())

	// Toggle collapse state for a planning session
	const toggleSessionCollapse = useCallback((sessionId: string) => {
		setCollapsedSessions((prev) => {
			const newSet = new Set(prev)
			if (newSet.has(sessionId)) {
				newSet.delete(sessionId)
			} else {
				newSet.add(sessionId)
			}
			return newSet
		})
	}, [])

	const handleHistorySelect = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}

	const toggleExpanded = () => {
		setIsExpanded(!isExpanded)
	}

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp)
		return date
			?.toLocaleString("en-US", {
				month: "long",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			})
			.replace(", ", " ")
			.replace(" at", ",")
			.toUpperCase()
	}

	// Group recent tasks by planning session and create collapsible structure
	const groupedRecentTasks = useMemo(() => {
		const { relatedTaskIds } = extensionStateContext
		const recentTasks = taskHistory.filter((item) => item.ts && item.task).slice(0, 3)

		if (!relatedTaskIds || relatedTaskIds.length === 0) {
			// No related tasks, return original tasks as individual items
			return recentTasks.map((task) => ({
				type: "task" as const,
				task: {
					...task,
					isRelated: false,
					relatedIndex: -1,
					totalRelated: 0,
				},
			}))
		}

		// Group tasks by planning session
		const sessionGroups = new Map<string, any[]>()
		const individualTasks: any[] = []

		recentTasks.forEach((task) => {
			if (task.planningSessionId && relatedTaskIds.includes(task.id)) {
				if (!sessionGroups.has(task.planningSessionId)) {
					sessionGroups.set(task.planningSessionId, [])
				}
				sessionGroups.get(task.planningSessionId)!.push({
					...task,
					isRelated: true,
					relatedIndex: task.phaseIndex || -1,
					totalRelated: task.totalPhases || 0,
				})
			} else {
				individualTasks.push({
					...task,
					isRelated: false,
					relatedIndex: -1,
					totalRelated: 0,
				})
			}
		})

		const groups: Array<{ type: "group" | "task"; sessionId?: string; tasks?: any[]; task?: any; isCollapsed?: boolean }> = []

		// Add planning session groups
		sessionGroups.forEach((tasks, sessionId) => {
			if (tasks.length > 1) {
				// Only group if there are multiple tasks
				// Sort tasks by phase index
				tasks.sort((a, b) => (a.phaseIndex || 0) - (b.phaseIndex || 0))
				groups.push({
					type: "group",
					sessionId,
					tasks,
					isCollapsed: collapsedSessions.has(sessionId),
				})
			} else if (tasks.length === 1) {
				// Single task, treat as individual
				groups.push({ type: "task", task: tasks[0] })
			}
		})

		// Add individual tasks
		individualTasks.forEach((task) => {
			groups.push({ type: "task", task })
		})

		return groups
	}, [taskHistory, extensionStateContext, collapsedSessions])

	// TaskCard component for rendering individual task cards
	const TaskCard = ({
		item,
		onSelect,
		formatDate,
	}: {
		item: any
		onSelect: (id: string) => void
		formatDate: (timestamp: number) => string
	}) => (
		<div
			key={item.id}
			className="relative rounded-xl p-3 cursor-pointer overflow-hidden transition-all duration-150 ease-out hover:scale-[1.02] hover:shadow-xl group hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_50%,transparent)] hover:border-[color-mix(in_srgb,var(--vscode-panel-border)_80%,transparent)]"
			style={{
				backgroundColor: item.isRelated
					? "color-mix(in srgb, var(--vscode-button-background) 12%, color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 30%, transparent))"
					: "color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 30%, transparent)",
				border: item.isRelated
					? "1px solid color-mix(in srgb, var(--vscode-button-background) 30%, transparent)"
					: "1px solid color-mix(in srgb, var(--vscode-panel-border) 50%, transparent)",
				borderLeft: item.isRelated ? "3px solid var(--vscode-button-background)" : undefined,
				backdropFilter: "blur(8px)",
			}}
			onClick={() => onSelect(item.id)}>
			{/* Subtle gradient overlay for extra depth */}
			<div
				className="absolute inset-0 transition-all duration-150 rounded-xl opacity-0 group-hover:opacity-100"
				style={{
					background:
						"linear-gradient(135deg, color-mix(in srgb, var(--vscode-button-background) 5%, transparent) 0%, color-mix(in srgb, var(--vscode-focusBorder) 3%, transparent) 100%)",
				}}
			/>

			{item.isFavorited && (
				<div className="absolute top-3 right-3 z-20 drop-shadow-sm" style={{ color: "var(--vscode-button-background)" }}>
					<span className="codicon codicon-star-full" aria-label="Favorited" />
				</div>
			)}

			<div className="relative z-10">
				<div className="mb-2 flex items-center gap-2">
					<span className="text-[var(--vscode-descriptionForeground)] font-medium text-xs uppercase tracking-wider opacity-80">
						{formatDate(item.ts)}
					</span>
					{item.isRelated && (
						<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
							<span
								className="codicon codicon-link"
								style={{
									color: "var(--vscode-button-background)",
									fontSize: "10px",
								}}
							/>
							<span
								style={{
									backgroundColor: "var(--vscode-button-background)",
									color: "var(--vscode-button-foreground)",
									fontSize: "0.6em",
									padding: "1px 4px",
									borderRadius: "6px",
									fontWeight: 600,
									textTransform: "uppercase",
								}}>
								Phase {item.relatedIndex}/{item.totalRelated}
							</span>
						</div>
					)}
				</div>

				<div
					id={`history-preview-task-${item.id}`}
					className="text-[var(--vscode-descriptionForeground)] mb-2 line-clamp-3 whitespace-pre-wrap break-words"
					style={{ fontSize: "var(--vscode-font-size)" }}>
					<span className="ph-no-capture">{item.task}</span>
				</div>

				<div className="text-xs text-[var(--vscode-descriptionForeground)] opacity-75 space-x-1">
					<span>
						Tokens: ↑{formatLargeNumber(item.tokensIn || 0)} ↓{formatLargeNumber(item.tokensOut || 0)}
					</span>
					{!!item.cacheWrites && (
						<>
							<span
								style={{
									color: "color-mix(in srgb, var(--vscode-descriptionForeground) 40%, transparent)",
								}}>
								•
							</span>
							<span>
								Cache: +{formatLargeNumber(item.cacheWrites || 0)} → {formatLargeNumber(item.cacheReads || 0)}
							</span>
						</>
					)}
					{!!item.totalCost && (
						<>
							<span
								style={{
									color: "color-mix(in srgb, var(--vscode-descriptionForeground) 40%, transparent)",
								}}>
								•
							</span>
							<span>API Cost: ${item.totalCost?.toFixed(4)}</span>
						</>
					)}
				</div>
			</div>
		</div>
	)

	return (
		<div className="flex-shrink-0">
			<div
				className="flex items-center gap-2 mx-5 my-2 cursor-pointer select-none text-[var(--vscode-descriptionForeground)] hover:opacity-80 transition-all duration-200 rounded-lg px-2 py-1 hover:bg-[var(--vscode-toolbar-hoverBackground)]"
				onClick={toggleExpanded}>
				<span
					className={`codicon codicon-chevron-${isExpanded ? "down" : "right"} scale-90 transition-transform duration-200`}
				/>
				<span className="codicon codicon-comment-discussion scale-90" />
				<span className="font-medium text-xs uppercase tracking-wide">Recent Tasks</span>
			</div>

			{isExpanded && (
				<div className="px-5 space-y-3">
					{groupedRecentTasks.length > 0 ? (
						<>
							{groupedRecentTasks.map((groupItem, index) => {
								// Render group header with collapse/expand functionality
								if (groupItem.type === "group") {
									const isCollapsed = groupItem.isCollapsed
									const sessionId = groupItem.sessionId!
									const tasks = groupItem.tasks!

									return (
										<div key={`group-${sessionId}`} className="space-y-2">
											{/* Group Header with collapse/expand */}
											<div
												className="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all duration-150 hover:bg-[var(--vscode-toolbar-hoverBackground)]"
												style={{
													backgroundColor:
														"color-mix(in srgb, var(--vscode-button-background) 8%, transparent)",
													border: "1px solid color-mix(in srgb, var(--vscode-button-background) 20%, transparent)",
												}}
												onClick={() => toggleSessionCollapse(sessionId)}>
												<span
													className={`codicon codicon-chevron-${isCollapsed ? "right" : "down"}`}
													style={{
														color: "var(--vscode-foreground)",
														fontSize: "12px",
														transition: "transform 0.2s ease",
													}}
												/>
												<span
													className="codicon codicon-collapse-all scale-75"
													style={{ color: "var(--vscode-button-background)" }}
												/>
												<span
													className="text-xs font-semibold"
													style={{ color: "var(--vscode-foreground)" }}>
													Request with Planning ({tasks.length} phases)
												</span>
												{!isCollapsed && (
													<span
														className="text-xs ml-auto"
														style={{ color: "var(--vscode-descriptionForeground)" }}>
														Phase {Math.min(...tasks.map((t) => t.phaseIndex || 1))} -{" "}
														{Math.max(...tasks.map((t) => t.phaseIndex || 1))}
													</span>
												)}
											</div>

											{/* Group Tasks - only show if not collapsed */}
											{!isCollapsed &&
												tasks.map((item) => (
													<TaskCard
														key={item.id}
														item={item}
														onSelect={handleHistorySelect}
														formatDate={formatDate}
													/>
												))}
										</div>
									)
								}

								// Render individual task
								return (
									<TaskCard
										key={groupItem.task.id}
										item={groupItem.task}
										onSelect={handleHistorySelect}
										formatDate={formatDate}
									/>
								)
							})}
							<div className="flex items-center justify-center pt-2">
								<button
									onClick={() => showHistoryView()}
									className="cursor-pointer text-center transition-all duration-150 hover:opacity-80 flex items-center gap-1 bg-transparent border-none outline-none focus:outline-none"
									style={{
										color: "var(--vscode-descriptionForeground)",
										fontSize: "var(--vscode-font-size)",
									}}>
									<span className="codicon codicon-history scale-90"></span>
									<span className="font-medium">View all history</span>
								</button>
							</div>
						</>
					) : (
						<div
							className="text-center text-[var(--vscode-descriptionForeground)] py-4 rounded-xl"
							style={{
								fontSize: "var(--vscode-font-size)",
								backgroundColor: "color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 20%, transparent)",
								border: "1px solid color-mix(in srgb, var(--vscode-panel-border) 30%, transparent)",
								backdropFilter: "blur(8px)",
							}}>
							No recent tasks
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default memo(HistoryPreview)
