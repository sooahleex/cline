import DangerButton from "@/components/common/DangerButton"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatLargeNumber, formatSize } from "@/utils/format"
import { vscode } from "@/utils/vscode"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { BooleanRequest, EmptyRequest, StringArrayRequest, StringRequest } from "@shared/proto/common"
import { GetTaskHistoryRequest, TaskFavoriteRequest } from "@shared/proto/task"
import { VSCodeButton, VSCodeCheckbox, VSCodeRadio, VSCodeRadioGroup, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse, { FuseResult } from "fuse.js"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useEvent } from "react-use"
import { Virtuoso } from "react-virtuoso"
import { string } from "zod"

type HistoryViewProps = {
	onDone: () => void
}

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

// Tailwind-styled radio with custom icon support - works independently of VSCodeRadioGroup but looks the same
// Used for workspace and favorites filters

interface CustomFilterRadioProps {
	checked: boolean
	onChange: () => void
	icon: string
	label: string
}

const CustomFilterRadio = ({ checked, onChange, icon, label }: CustomFilterRadioProps) => {
	return (
		<div
			onClick={onChange}
			className="flex items-center cursor-pointer py-[0.3em] px-0 mr-[10px] text-[var(--vscode-font-size)] select-none">
			<div
				className={`w-[14px] h-[14px] rounded-full border border-[var(--vscode-checkbox-border)] relative flex justify-center items-center mr-[6px] ${
					checked ? "bg-[var(--vscode-checkbox-background)]" : "bg-transparent"
				}`}>
				{checked && <div className="w-[6px] h-[6px] rounded-full bg-[var(--vscode-checkbox-foreground)]" />}
			</div>
			<span className="flex items-center gap-[3px]">
				<div className={`codicon codicon-${icon} text-[var(--vscode-button-background)] text-base`} />
				{label}
			</span>
		</div>
	)
}

const HistoryView = ({ onDone }: HistoryViewProps) => {
	const extensionStateContext = useExtensionState()
	const { taskHistory, filePaths, onRelinquishControl } = extensionStateContext
	const [searchQuery, setSearchQuery] = useState("")
	const [sortOption, setSortOption] = useState<SortOption>("newest")
	const [lastNonRelevantSort, setLastNonRelevantSort] = useState<SortOption | null>("newest")
	const [deleteAllDisabled, setDeleteAllDisabled] = useState(false)
	const [selectedItems, setSelectedItems] = useState<string[]>([])
	const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
	const [showCurrentWorkspaceOnly, setShowCurrentWorkspaceOnly] = useState(false)

	// Keep track of pending favorite toggle operations
	const [pendingFavoriteToggles, setPendingFavoriteToggles] = useState<Record<string, boolean>>({})

	// Keep track of collapsed planning sessions
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

	// Load filtered task history with gRPC
	const [filteredTasks, setFilteredTasks] = useState<any[]>([])

	// Load and refresh task history
	const loadTaskHistory = useCallback(async () => {
		try {
			const response = await TaskServiceClient.getTaskHistory(
				GetTaskHistoryRequest.create({
					favoritesOnly: showFavoritesOnly,
					searchQuery: searchQuery || undefined,
					sortBy: sortOption,
					currentWorkspaceOnly: showCurrentWorkspaceOnly,
				}),
			)
			setFilteredTasks(response.tasks || [])
		} catch (error) {
			console.error("Error loading task history:", error)
		}
	}, [showFavoritesOnly, showCurrentWorkspaceOnly, searchQuery, sortOption, taskHistory])

	// Load when filters change
	useEffect(() => {
		// Force a complete refresh when both filters are active
		// to ensure proper combined filtering
		if (showFavoritesOnly && showCurrentWorkspaceOnly) {
			setFilteredTasks([])
		}
		loadTaskHistory()
	}, [loadTaskHistory, showFavoritesOnly, showCurrentWorkspaceOnly])

	const toggleFavorite = useCallback(
		async (taskId: string, currentValue: boolean) => {
			// Optimistic UI update
			setPendingFavoriteToggles((prev) => ({ ...prev, [taskId]: !currentValue }))

			try {
				await TaskServiceClient.toggleTaskFavorite(
					TaskFavoriteRequest.create({
						taskId,
						isFavorited: !currentValue,
					}),
				)

				// Refresh if either filter is active to ensure proper combined filtering
				if (showFavoritesOnly || showCurrentWorkspaceOnly) {
					loadTaskHistory()
				}
			} catch (err) {
				console.error(`[FAVORITE_TOGGLE_UI] Error for task ${taskId}:`, err)
				// Revert optimistic update
				setPendingFavoriteToggles((prev) => {
					const updated = { ...prev }
					delete updated[taskId]
					return updated
				})
			} finally {
				// Clean up pending state after 1 second
				setTimeout(() => {
					setPendingFavoriteToggles((prev) => {
						const updated = { ...prev }
						delete updated[taskId]
						return updated
					})
				}, 1000)
			}
		},
		[showFavoritesOnly, loadTaskHistory],
	)

	// Use the onRelinquishControl hook instead of message event
	useEffect(() => {
		return onRelinquishControl(() => {
			setDeleteAllDisabled(false)
		})
	}, [onRelinquishControl])

	const { totalTasksSize, setTotalTasksSize } = extensionStateContext

	const fetchTotalTasksSize = useCallback(async () => {
		try {
			const response = await TaskServiceClient.getTotalTasksSize(EmptyRequest.create({}))
			if (response && typeof response.value === "number") {
				setTotalTasksSize?.(response.value || 0)
			}
		} catch (error) {
			console.error("Error getting total tasks size:", error)
		}
	}, [setTotalTasksSize])

	// Request total tasks size when component mounts
	useEffect(() => {
		fetchTotalTasksSize()
	}, [fetchTotalTasksSize])

	useEffect(() => {
		if (searchQuery && sortOption !== "mostRelevant" && !lastNonRelevantSort) {
			setLastNonRelevantSort(sortOption)
			setSortOption("mostRelevant")
		} else if (!searchQuery && sortOption === "mostRelevant" && lastNonRelevantSort) {
			setSortOption(lastNonRelevantSort)
			setLastNonRelevantSort(null)
		}
	}, [searchQuery, sortOption, lastNonRelevantSort])

	const handleShowTaskWithId = useCallback((id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}, [])

	const handleHistorySelect = useCallback((itemId: string, checked: boolean) => {
		setSelectedItems((prev) => {
			if (checked) {
				return [...prev, itemId]
			} else {
				return prev.filter((id) => id !== itemId)
			}
		})
	}, [])

	const handleDeleteHistoryItem = useCallback(
		(id: string) => {
			TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [id] }))
				.then(() => fetchTotalTasksSize())
				.catch((error) => console.error("Error deleting task:", error))
		},
		[fetchTotalTasksSize],
	)

	const handleDeleteSelectedHistoryItems = useCallback(
		(ids: string[]) => {
			if (ids.length > 0) {
				TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: ids }))
					.then(() => fetchTotalTasksSize())
					.catch((error) => console.error("Error deleting tasks:", error))
				setSelectedItems([])
			}
		},
		[fetchTotalTasksSize],
	)

	const formatDate = useCallback((timestamp: number) => {
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
	}, [])

	// Use taskHistory from extension state instead of filtered tasks for phase info
	const presentableTasks = useMemo(() => {
		// If we have filtered tasks from gRPC, use them but merge with taskHistory for phase info
		if (filteredTasks.length > 0) {
			return filteredTasks.map((filteredTask) => {
				// Find corresponding task in taskHistory to get phase info
				const taskFromHistory = taskHistory.find((historyTask) => historyTask.id === filteredTask.id)
				return {
					...filteredTask,
					// Merge phase information from taskHistory
					phaseIndex: taskFromHistory?.phaseIndex,
					totalPhases: taskFromHistory?.totalPhases,
					planningSessionId: taskFromHistory?.planningSessionId,
				}
			})
		}
		// Fallback to taskHistory if no filtered tasks
		return taskHistory.filter((item) => item.ts && item.task)
	}, [filteredTasks, taskHistory])

	const fuse = useMemo(() => {
		return new Fuse(presentableTasks, {
			keys: ["task"],
			threshold: 0.6,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [presentableTasks])

	const taskHistorySearchResults = useMemo(() => {
		const results = searchQuery ? highlight(fuse.search(searchQuery)) : presentableTasks

		results.sort((a, b) => {
			switch (sortOption) {
				case "oldest":
					return a.ts - b.ts
				case "mostExpensive":
					return (b.totalCost || 0) - (a.totalCost || 0)
				case "mostTokens":
					return (
						(b.tokensIn || 0) +
						(b.tokensOut || 0) +
						(b.cacheWrites || 0) +
						(b.cacheReads || 0) -
						((a.tokensIn || 0) + (a.tokensOut || 0) + (a.cacheWrites || 0) + (a.cacheReads || 0))
					)
				case "mostRelevant":
					// NOTE: you must never sort directly on object since it will cause members to be reordered
					return searchQuery ? 0 : b.ts - a.ts // Keep fuse order if searching, otherwise sort by newest
				case "newest":
				default:
					return b.ts - a.ts
			}
		})

		return results
	}, [presentableTasks, searchQuery, fuse, sortOption])

	// Group tasks by planning session and create collapsible structure
	const groupedTasksData = useMemo(() => {
		const { relatedTaskIds } = extensionStateContext
		const groups: Array<{ type: "group" | "task"; sessionId?: string; tasks?: any[]; task?: any; isCollapsed?: boolean }> = []
		const processedTaskIds = new Set<string>()

		// Group tasks by planning session
		const sessionGroups = new Map<string, any[]>()

		taskHistorySearchResults.forEach((task) => {
			if (task.planningSessionId && relatedTaskIds?.includes(task.id)) {
				if (!sessionGroups.has(task.planningSessionId)) {
					sessionGroups.set(task.planningSessionId, [])
				}
				sessionGroups.get(task.planningSessionId)!.push({
					...task,
					isRelated: true,
					relatedIndex: task.phaseIndex || -1,
					totalRelated: task.totalPhases || 0,
				})
				processedTaskIds.add(task.id)
			}
		})

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

		// Add individual tasks (not part of any planning session)
		taskHistorySearchResults.forEach((task) => {
			if (!processedTaskIds.has(task.id)) {
				groups.push({
					type: "task",
					task: {
						...task,
						isRelated: false,
						relatedIndex: -1,
						totalRelated: 0,
					},
				})
			}
		})

		return groups
	}, [taskHistorySearchResults, extensionStateContext, collapsedSessions])

	// Calculate total size of selected items
	const selectedItemsSize = useMemo(() => {
		if (selectedItems.length === 0) return 0

		return taskHistory.filter((item) => selectedItems.includes(item.id)).reduce((total, item) => total + (item.size || 0), 0)
	}, [selectedItems, taskHistory])

	const handleBatchHistorySelect = useCallback(
		(selectAll: boolean) => {
			if (selectAll) {
				setSelectedItems(taskHistorySearchResults.map((item) => item.id))
			} else {
				setSelectedItems([])
			}
		},
		[taskHistorySearchResults],
	)

	return (
		<>
			<style>
				{`
					.history-item:hover {
						background-color: var(--vscode-list-hoverBackground);
					}
					.delete-button, .export-button {
						opacity: 0;
						pointer-events: none;
					}
					.history-item:hover .delete-button,
					.history-item:hover .export-button {
						opacity: 1;
						pointer-events: auto;
					}
					.history-item-highlight {
						background-color: var(--vscode-editor-findMatchHighlightBackground);
						color: inherit;
					}
				`}
			</style>
			<div
				style={{
					position: "fixed",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "10px 17px 10px 20px",
					}}>
					<h3
						style={{
							color: "var(--vscode-foreground)",
							margin: 0,
						}}>
						History
					</h3>
					<VSCodeButton onClick={onDone}>Done</VSCodeButton>
				</div>
				<div style={{ padding: "5px 17px 6px 17px" }}>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "6px",
						}}>
						<VSCodeTextField
							style={{ width: "100%" }}
							placeholder="Fuzzy search history..."
							value={searchQuery}
							onInput={(e) => {
								const newValue = (e.target as HTMLInputElement)?.value
								setSearchQuery(newValue)
								if (newValue && !searchQuery && sortOption !== "mostRelevant") {
									setLastNonRelevantSort(sortOption)
									setSortOption("mostRelevant")
								}
							}}>
							<div
								slot="start"
								className="codicon codicon-search"
								style={{
									fontSize: 13,
									marginTop: 2.5,
									opacity: 0.8,
								}}></div>
							{searchQuery && (
								<div
									className="input-icon-button codicon codicon-close"
									aria-label="Clear search"
									onClick={() => setSearchQuery("")}
									slot="end"
									style={{
										display: "flex",
										justifyContent: "center",
										alignItems: "center",
										height: "100%",
									}}
								/>
							)}
						</VSCodeTextField>
						<VSCodeRadioGroup
							style={{ display: "flex", flexWrap: "wrap" }}
							value={sortOption}
							onChange={(e) => setSortOption((e.target as HTMLInputElement).value as SortOption)}>
							<VSCodeRadio value="newest">Newest</VSCodeRadio>
							<VSCodeRadio value="oldest">Oldest</VSCodeRadio>
							<VSCodeRadio value="mostExpensive">Most Expensive</VSCodeRadio>
							<VSCodeRadio value="mostTokens">Most Tokens</VSCodeRadio>
							<VSCodeRadio value="mostRelevant" disabled={!searchQuery} style={{ opacity: searchQuery ? 1 : 0.5 }}>
								Most Relevant
							</VSCodeRadio>
							<CustomFilterRadio
								checked={showCurrentWorkspaceOnly}
								onChange={() => setShowCurrentWorkspaceOnly(!showCurrentWorkspaceOnly)}
								icon="workspace"
								label="Workspace"
							/>
							<CustomFilterRadio
								checked={showFavoritesOnly}
								onChange={() => setShowFavoritesOnly(!showFavoritesOnly)}
								icon="star-full"
								label="Favorites"
							/>
						</VSCodeRadioGroup>

						<div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
							<VSCodeButton
								onClick={() => {
									handleBatchHistorySelect(true)
								}}>
								Select All
							</VSCodeButton>
							<VSCodeButton
								onClick={() => {
									handleBatchHistorySelect(false)
								}}>
								Select None
							</VSCodeButton>
						</div>
					</div>
				</div>
				<div style={{ flexGrow: 1, overflowY: "auto", margin: 0 }}>
					{/* {presentableTasks.length === 0 && (
						<div
							style={{
								
								alignItems: "center",
								fontStyle: "italic",
								color: "var(--vscode-descriptionForeground)",
								textAlign: "center",
								padding: "0px 10px",
							}}>
							<span
								className="codicon codicon-robot"
								style={{ fontSize: "60px", marginBottom: "10px" }}></span>
							<div>Start a task to see it here</div>
						</div>
					)} */}
					<Virtuoso
						style={{
							flexGrow: 1,
							overflowY: "scroll",
						}}
						data={groupedTasksData}
						itemContent={(index, groupItem) => {
							// Render group header with collapse/expand functionality
							if (groupItem.type === "group") {
								const isCollapsed = groupItem.isCollapsed
								const sessionId = groupItem.sessionId!
								const tasks = groupItem.tasks!

								return (
									<div key={`group-${sessionId}`}>
										{/* Group Header with collapse/expand */}
										<div
											style={{
												padding: "8px 20px",
												backgroundColor: "var(--vscode-toolbar-hoverBackground)",
												borderBottom: "1px solid var(--vscode-panel-border)",
												borderTop: index > 0 ? "1px solid var(--vscode-panel-border)" : "none",
												display: "flex",
												alignItems: "center",
												gap: "8px",
												cursor: "pointer",
											}}
											onClick={() => toggleSessionCollapse(sessionId)}>
											<span
												className={`codicon codicon-chevron-${isCollapsed ? "right" : "down"}`}
												style={{
													color: "var(--vscode-foreground)",
													fontSize: "14px",
													transition: "transform 0.2s ease",
												}}
											/>
											<span
												className="codicon codicon-organization"
												style={{ color: "var(--vscode-button-background)" }}
											/>
											<span
												style={{
													color: "var(--vscode-foreground)",
													fontWeight: 600,
													fontSize: "0.9em",
												}}>
												Planning Session ({tasks.length} phases)
											</span>
											{!isCollapsed && (
												<span
													style={{
														color: "var(--vscode-descriptionForeground)",
														fontSize: "0.8em",
														marginLeft: "auto",
													}}>
													Phase {Math.min(...tasks.map((t) => t.phaseIndex || 1))} -{" "}
													{Math.max(...tasks.map((t) => t.phaseIndex || 1))}
												</span>
											)}
										</div>

										{/* Group Tasks - only show if not collapsed */}
										{!isCollapsed &&
											tasks.map((task, taskIndex) => (
												<TaskItem
													key={task.id}
													task={task}
													index={taskIndex}
													isGrouped={true}
													selectedItems={selectedItems}
													pendingFavoriteToggles={pendingFavoriteToggles}
													onHistorySelect={handleHistorySelect}
													onShowTask={handleShowTaskWithId}
													onDeleteTask={handleDeleteHistoryItem}
													onToggleFavorite={toggleFavorite}
													formatDate={formatDate}
												/>
											))}
									</div>
								)
							}

							// Render individual task
							return (
								<TaskItem
									key={groupItem.task.id}
									task={groupItem.task}
									index={index}
									isGrouped={false}
									selectedItems={selectedItems}
									pendingFavoriteToggles={pendingFavoriteToggles}
									onHistorySelect={handleHistorySelect}
									onShowTask={handleShowTaskWithId}
									onDeleteTask={handleDeleteHistoryItem}
									onToggleFavorite={toggleFavorite}
									formatDate={formatDate}
								/>
							)
						}}
					/>
				</div>
				<div
					style={{
						padding: "10px 10px",
						borderTop: "1px solid var(--vscode-panel-border)",
					}}>
					{selectedItems.length > 0 ? (
						<DangerButton
							style={{ width: "100%" }}
							onClick={() => {
								handleDeleteSelectedHistoryItems(selectedItems)
							}}>
							Delete {selectedItems.length > 1 ? selectedItems.length : ""} Selected
							{selectedItemsSize > 0 ? ` (${formatSize(selectedItemsSize)})` : ""}
						</DangerButton>
					) : (
						<DangerButton
							style={{ width: "100%" }}
							disabled={deleteAllDisabled || taskHistory.length === 0}
							onClick={() => {
								setDeleteAllDisabled(true)
								TaskServiceClient.deleteAllTaskHistory(BooleanRequest.create({}))
									.catch((error) => console.error("Error deleting task history:", error))
									.finally(() => setDeleteAllDisabled(false))
							}}>
							Delete All History{totalTasksSize !== null ? ` (${formatSize(totalTasksSize)})` : ""}
						</DangerButton>
					)}
				</div>
			</div>
		</>
	)
}

// TaskItem component for rendering individual tasks
interface TaskItemProps {
	task: any
	index: number
	isGrouped: boolean
	selectedItems: string[]
	pendingFavoriteToggles: Record<string, boolean>
	onHistorySelect: (itemId: string, checked: boolean) => void
	onShowTask: (id: string) => void
	onDeleteTask: (id: string) => void
	onToggleFavorite: (taskId: string, currentValue: boolean) => void
	formatDate: (timestamp: number) => string
}

const TaskItem = ({
	task,
	index,
	isGrouped,
	selectedItems,
	pendingFavoriteToggles,
	onHistorySelect,
	onShowTask,
	onDeleteTask,
	onToggleFavorite,
	formatDate,
}: TaskItemProps) => (
	<div
		key={task.id}
		className="history-item"
		style={{
			cursor: "pointer",
			borderBottom: "1px solid var(--vscode-panel-border)",
			display: "flex",
			backgroundColor: task.isRelated ? "color-mix(in srgb, var(--vscode-button-background) 8%, transparent)" : undefined,
			borderLeft: task.isRelated ? "3px solid var(--vscode-button-background)" : "3px solid transparent",
			marginLeft: isGrouped ? "16px" : "0px",
		}}>
		<VSCodeCheckbox
			className="pl-3 pr-1 py-auto"
			checked={selectedItems.includes(task.id)}
			onClick={(e) => {
				const checked = (e.target as HTMLInputElement).checked
				onHistorySelect(task.id, checked)
				e.stopPropagation()
			}}
		/>
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "8px",
				padding: "12px 20px",
				paddingLeft: "16px",
				position: "relative",
				flexGrow: 1,
			}}
			onClick={() => onShowTask(task.id)}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}>
				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<span
						style={{
							color: "var(--vscode-descriptionForeground)",
							fontWeight: 500,
							fontSize: "0.85em",
							textTransform: "uppercase",
						}}>
						{formatDate(task.ts)}
					</span>
					{task.isRelated && (
						<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
							<span
								className="codicon codicon-link"
								style={{
									color: "var(--vscode-button-background)",
									fontSize: "12px",
								}}
							/>
							<span
								style={{
									backgroundColor: "var(--vscode-button-background)",
									color: "var(--vscode-button-foreground)",
									fontSize: "0.7em",
									padding: "2px 6px",
									borderRadius: "8px",
									fontWeight: 600,
									textTransform: "uppercase",
								}}>
								Phase {task.relatedIndex}/{task.totalRelated}
							</span>
						</div>
					)}
				</div>
				<div style={{ display: "flex", gap: "4px" }}>
					{!(pendingFavoriteToggles[task.id] ?? task.isFavorited) && (
						<VSCodeButton
							appearance="icon"
							onClick={(e) => {
								e.stopPropagation()
								onDeleteTask(task.id)
							}}
							className="delete-button"
							style={{ padding: "0px 0px" }}>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "3px",
									fontSize: "11px",
								}}>
								<span className="codicon codicon-trash"></span>
								{formatSize(task.size)}
							</div>
						</VSCodeButton>
					)}
					<VSCodeButton
						appearance="icon"
						onClick={(e) => {
							e.stopPropagation()
							onToggleFavorite(task.id, task.isFavorited || false)
						}}
						style={{ padding: "0px" }}>
						<div
							className={`codicon ${
								pendingFavoriteToggles[task.id] !== undefined
									? pendingFavoriteToggles[task.id]
										? "codicon-star-full"
										: "codicon-star-empty"
									: task.isFavorited
										? "codicon-star-full"
										: "codicon-star-empty"
							}`}
							style={{
								color:
									(pendingFavoriteToggles[task.id] ?? task.isFavorited)
										? "var(--vscode-button-background)"
										: "inherit",
								opacity: (pendingFavoriteToggles[task.id] ?? task.isFavorited) ? 1 : 0.7,
								display: (pendingFavoriteToggles[task.id] ?? task.isFavorited) ? "block" : undefined,
							}}
						/>
					</VSCodeButton>
				</div>
			</div>

			<div style={{ marginBottom: "8px", position: "relative" }}>
				<div
					style={{
						fontSize: "var(--vscode-font-size)",
						color: "var(--vscode-foreground)",
						display: "-webkit-box",
						WebkitLineClamp: 3,
						WebkitBoxOrient: "vertical",
						overflow: "hidden",
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
						overflowWrap: "anywhere",
					}}>
					<span
						className="ph-no-capture"
						dangerouslySetInnerHTML={{
							__html: task.task,
						}}
					/>
				</div>
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "4px",
				}}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "4px",
							flexWrap: "wrap",
						}}>
						<span
							style={{
								fontWeight: 500,
								color: "var(--vscode-descriptionForeground)",
							}}>
							Tokens:
						</span>
						<span
							style={{
								display: "flex",
								alignItems: "center",
								gap: "3px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							<i
								className="codicon codicon-arrow-up"
								style={{
									fontSize: "12px",
									fontWeight: "bold",
									marginBottom: "-2px",
								}}
							/>
							{formatLargeNumber(task.tokensIn || 0)}
						</span>
						<span
							style={{
								display: "flex",
								alignItems: "center",
								gap: "3px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							<i
								className="codicon codicon-arrow-down"
								style={{
									fontSize: "12px",
									fontWeight: "bold",
									marginBottom: "-2px",
								}}
							/>
							{formatLargeNumber(task.tokensOut || 0)}
						</span>
					</div>
					{!task.totalCost && <ExportButton itemId={task.id} />}
				</div>

				{!!task.cacheWrites && (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "4px",
							flexWrap: "wrap",
						}}>
						<span
							style={{
								fontWeight: 500,
								color: "var(--vscode-descriptionForeground)",
							}}>
							Cache:
						</span>
						<span
							style={{
								display: "flex",
								alignItems: "center",
								gap: "3px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							<i
								className="codicon codicon-database"
								style={{
									fontSize: "12px",
									fontWeight: "bold",
									marginBottom: "-1px",
								}}
							/>
							+{formatLargeNumber(task.cacheWrites || 0)}
						</span>
						<span
							style={{
								display: "flex",
								alignItems: "center",
								gap: "3px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							<i
								className="codicon codicon-arrow-right"
								style={{
									fontSize: "12px",
									fontWeight: "bold",
									marginBottom: 0,
								}}
							/>
							{formatLargeNumber(task.cacheReads || 0)}
						</span>
					</div>
				)}
				{!!task.totalCost && (
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginTop: -2,
						}}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "4px",
							}}>
							<span
								style={{
									fontWeight: 500,
									color: "var(--vscode-descriptionForeground)",
								}}>
								API Cost:
							</span>
							<span
								style={{
									color: "var(--vscode-descriptionForeground)",
								}}>
								${task.totalCost?.toFixed(4)}
							</span>
						</div>
						<ExportButton itemId={task.id} />
					</div>
				)}
			</div>
		</div>
	</div>
)

const ExportButton = ({ itemId }: { itemId: string }) => (
	<VSCodeButton
		className="export-button"
		appearance="icon"
		onClick={(e) => {
			e.stopPropagation()
			TaskServiceClient.exportTaskWithId(StringRequest.create({ value: itemId })).catch((err) =>
				console.error("Failed to export task:", err),
			)
		}}>
		<div style={{ fontSize: "11px", fontWeight: 500, opacity: 1 }}>EXPORT</div>
	</VSCodeButton>
)

// https://gist.github.com/evenfrost/1ba123656ded32fb7a0cd4651efd4db0
export const highlight = (fuseSearchResult: FuseResult<any>[], highlightClassName: string = "history-item-highlight") => {
	const set = (obj: Record<string, any>, path: string, value: any) => {
		const pathValue = path.split(".")
		let i: number

		for (i = 0; i < pathValue.length - 1; i++) {
			obj = obj[pathValue[i]] as Record<string, any>
		}

		obj[pathValue[i]] = value
	}

	// Function to merge overlapping regions
	const mergeRegions = (regions: [number, number][]): [number, number][] => {
		if (regions.length === 0) return regions

		// Sort regions by start index
		regions.sort((a, b) => a[0] - b[0])

		const merged: [number, number][] = [regions[0]]

		for (let i = 1; i < regions.length; i++) {
			const last = merged[merged.length - 1]
			const current = regions[i]

			if (current[0] <= last[1] + 1) {
				// Overlapping or adjacent regions
				last[1] = Math.max(last[1], current[1])
			} else {
				merged.push(current)
			}
		}

		return merged
	}

	const generateHighlightedText = (inputText: string, regions: [number, number][] = []) => {
		if (regions.length === 0) {
			return inputText
		}

		// Sort and merge overlapping regions
		const mergedRegions = mergeRegions(regions)

		let content = ""
		let nextUnhighlightedRegionStartingIndex = 0

		mergedRegions.forEach((region) => {
			const start = region[0]
			const end = region[1]
			const lastRegionNextIndex = end + 1

			content += [
				inputText.substring(nextUnhighlightedRegionStartingIndex, start),
				`<span class="${highlightClassName}">`,
				inputText.substring(start, lastRegionNextIndex),
				"</span>",
			].join("")

			nextUnhighlightedRegionStartingIndex = lastRegionNextIndex
		})

		content += inputText.substring(nextUnhighlightedRegionStartingIndex)

		return content
	}

	return fuseSearchResult
		.filter(({ matches }) => matches && matches.length)
		.map(({ item, matches }) => {
			const highlightedItem = { ...item }

			matches?.forEach((match) => {
				if (match.key && typeof match.value === "string" && match.indices) {
					// Merge overlapping regions before generating highlighted text
					const mergedIndices = mergeRegions([...match.indices])
					set(highlightedItem, match.key, generateHighlightedText(match.value, mergedIndices))
				}
			})

			return highlightedItem
		})
}

export default memo(HistoryView)
