import { Anthropic } from "@anthropic-ai/sdk"
import { ClineApiReqInfo, ClineMessage } from "../../../shared/ExtensionMessage"
import { ApiHandler } from "../../../api"
import { getContextWindowInfo } from "./context-window-utils"

class ContextManager {
	getNewContextMessagesAndMetadata(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		clineMessages: ClineMessage[],
		api: ApiHandler,
		conversationHistoryDeletedRange: [number, number] | undefined,
		previousApiReqIndex: number,
	) {
		let updatedConversationHistoryDeletedRange = false

		// If the previous API request's total token usage is close to the context window, truncate the conversation history to free up space for the new request
		if (previousApiReqIndex >= 0) {
			const previousRequest = clineMessages[previousApiReqIndex]
			if (previousRequest && previousRequest.text) {
				const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(previousRequest.text)
				const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
				const { maxAllowedSize } = getContextWindowInfo(api)

				// This is the most reliable way to know when we're close to hitting the context window.
				if (totalTokens >= maxAllowedSize) {
					// Since the user may switch between models with different context windows, truncating half may not be enough (ie if switching from claude 200k to deepseek 64k, half truncation will only remove 100k tokens, but we need to remove much more)
					// So if totalTokens/2 is greater than maxAllowedSize, we truncate 3/4 instead of 1/2
					// FIXME: truncating the conversation in a way that is optimal for prompt caching AND takes into account multi-context window complexity is something we need to improve
					const keep = totalTokens / 2 > maxAllowedSize ? "quarter" : "half"

					// NOTE: it's okay that we overwriteConversationHistory in resume task since we're only ever removing the last user message and not anything in the middle which would affect this range
					conversationHistoryDeletedRange = this.getNextTruncationRange(
						apiConversationHistory,
						conversationHistoryDeletedRange,
						// keep,
						maxAllowedSize,
					)

					updatedConversationHistoryDeletedRange = true
				}
			}
		}

		// conversationHistoryDeletedRange is updated only when we're close to hitting the context window, so we don't continuously break the prompt cache
		const truncatedConversationHistory = this.getTruncatedMessages(apiConversationHistory, conversationHistoryDeletedRange)

		return {
			conversationHistoryDeletedRange: conversationHistoryDeletedRange,
			updatedConversationHistoryDeletedRange: updatedConversationHistoryDeletedRange,
			truncatedConversationHistory: truncatedConversationHistory,
		}
	}

	public getNextTruncationRange(
		apiMessages: Anthropic.Messages.MessageParam[],
		currentDeletedRange: [number, number] | undefined,
		// keep: "half" | "quarter",
		maxAllowedTokens: number,
	): [number, number] {
		// We always keep the first user-assistant pairing, and truncate an even number of messages from there
		const totalMessages = apiMessages.length;
		const tokenCounts = apiMessages.map(m => this.countTokens(m));

		// 1) 뒤에서부터 누적하면서 maxAllowedTokens를 초과하지 않는 범위의 시작 인덱스를 찾는다.
		let accumulated = 0;
		let windowStart = totalMessages; // 유지할 구간의 시작 인덱스
		for (let i = totalMessages - 1; i >= 0; i--) {
			if (accumulated + tokenCounts[i] > maxAllowedTokens) {
				break;
			}
			accumulated += tokenCounts[i];
			windowStart = i;
		}

		// 2) 항상 첫번째 user-assistant 쌍을 유지하고, 그 이후의 메시지에서 짝수 개의 메시지를 제거한다.
		const prevDeleteEnd = currentDeletedRange ? currentDeletedRange[1] : -1;
		const deleteStart = prevDeleteEnd + 1; // 삭제할 메시지의 시작 인덱스
  		
		// 3) windowStart 바로 앞까지(deleteStart…windowStart-1) 삭제
  		//    단, deleteStart > windowStart-1 이면 삭제할 게 없음
		let deleteEnd = Math.max(windowStart - 1, deleteStart - 1);
		
		// Make sure that the last message being removed is a assistant message, so the next message after the initial user-assistant pair is an assistant message. This preserves the user-assistant-user-assistant structure.
		// NOTE: anthropic format messages are always user-assistant-user-assistant, while openai format messages can have multiple user messages in a row (we use anthropic format throughout cline)
		if (apiMessages[deleteEnd].role !== "assistant") {
			deleteEnd -= 1
		}

		// this is an inclusive range that will be removed from the conversation history
		return [deleteStart, deleteEnd]
	}

	private countTokens(msg: Anthropic.Messages.MessageParam): number {
		let text: string;
		if (typeof msg.content === "string") {
		  text = msg.content;
		} else {
		  text = msg.content.map(b => ("text" in b ? b.text : JSON.stringify(b))).join(" ");
		}
		return text.trim().split(/\s+/).filter(Boolean).length;
	  }

	public getTruncatedMessages(
		messages: Anthropic.Messages.MessageParam[],
		deletedRange: [number, number] | undefined,
	): Anthropic.Messages.MessageParam[] {
		if (!deletedRange) {
			return messages
		}

		const [start, end] = deletedRange
		// the range is inclusive - both start and end indices and everything in between will be removed from the final result.
		// NOTE: if you try to console log these, don't forget that logging a reference to an array may not provide the same result as logging a slice() snapshot of that array at that exact moment. The following DOES in fact include the latest assistant message.
		return [...messages.slice(0, start), ...messages.slice(end + 1)]
	}
}
