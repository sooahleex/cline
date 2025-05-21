import { Anthropic } from "@anthropic-ai/sdk"
import { has } from "node_modules/cheerio/dist/esm/api/traversing"
import OpenAI from "openai"

export const PLANNING_PROMPT = `
You are a coding assistant that must break down the user's request into phases.

**1) Provide your complete 'assistantMessage'** with these tag rules:
- \`<thinking>…</thinking>\`: Summarize your internal reasoning or approach
- \`<execute_command>…</execute_command>\`: Shell commands to run
- \`<write_to_file>…</write_to_file>\`: File creation or editing
- \`<attempt_completion>…</attempt_completion>\`: Summaries or final completion output

Within \`assistantMessage\`, you can place multiple tags, but do not add extra disclaimers or text outside these tags.

**2) After that entire 'assistantMessage', add a divider** line:
\`\`\`
---
## Phase Plan
\`\`\`

**3) Provide the Phase Plan** using *either* the “Text Format” *or* the “JSON Format”.  
- If you need **1, 2, or more** phases, create exactly that many.  
- The example shows 2 phases for illustration only. **Add as many phases as you see fit.**  

**Text Format**:
\`\`\`
Phase 1: [Phase Name or Title]
- Description: [Brief explanation of this phase]
- Paths:
  pathA
  pathB
- Subtasks:
  * [Subtask 1]
  * [Subtask 2]

Phase 2: [Another Phase]
- Description: ...
- ...
Phase 3: ...
\`\`\`

**JSON Format**:
\`\`\`json
{
  "phases": [
    {
      "index": 1,
      "phase_prompt": "Name/Description",
      "description": "Brief explanation",
      "paths": ["pathA", "pathB"],
      "subtasks": [
        {"description": "some subtask", "type": "write_to_file"},
        ...
      ]
    },
    {
      "index": 2,
      "phase_prompt": "Another Phase",
      "description": "Brief explanation",
      ...
    }
    // add as many as you need
  ]
}
\`\`\`

Remember:
1. \`assistantMessage\` must come first (with the tags).
2. Then the divider line: \`---\\n## Phase Plan\`
3. Then your phases. 
`


export function convertToOpenAiMessages(
	anthropicMessages: Anthropic.Messages.MessageParam[],
	hasInsertedPlanningPromptOnce: boolean = false,
): OpenAI.Chat.ChatCompletionMessageParam[] {
	const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

	for (const anthropicMessage of anthropicMessages) {
		if (typeof anthropicMessage.content === "string") {
			openAiMessages.push({
				role: anthropicMessage.role,
				content: anthropicMessage.content,
			})
		} else {
			// image_url.url is base64 encoded image data
			// ensure it contains the content-type of the image: data:image/png;base64,
			/*
        { role: "user", content: "" | { type: "text", text: string } | { type: "image_url", image_url: { url: string } } },
         // content required unless tool_calls is present
        { role: "assistant", content?: "" | null, tool_calls?: [{ id: "", function: { name: "", arguments: "" }, type: "function" }] },
        { role: "tool", tool_call_id: "", content: ""}
         */
			if (anthropicMessage.role === "user") {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolResultBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_result") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						} // user cannot send tool_use messages
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process tool result messages FIRST since they must follow the tool use messages
				const toolResultImages: Anthropic.Messages.ImageBlockParam[] = []
				toolMessages.forEach((toolMessage) => {
					// The Anthropic SDK allows tool results to be a string or an array of text and image blocks, enabling rich and structured content. In contrast, the OpenAI SDK only supports tool results as a single string, so we map the Anthropic tool result parts into one concatenated string to maintain compatibility.
					let content: string

					if (typeof toolMessage.content === "string") {
						content = toolMessage.content
					} else {
						content =
							toolMessage.content
								?.map((part) => {
									if (part.type === "image") {
										toolResultImages.push(part)
										return "(see following user message for image)"
									}
									return part.text
								})
								.join("\n") ?? ""
					}
					openAiMessages.push({
						role: "tool",
						tool_call_id: toolMessage.tool_use_id,
						content: content,
					})
				})

				// If tool results contain images, send as a separate user message
				// I ran into an issue where if I gave feedback for one of many tool uses, the request would fail.
				// "Messages following `tool_use` blocks must begin with a matching number of `tool_result` blocks."
				// Therefore we need to send these images after the tool result messages
				// NOTE: it's actually okay to have multiple user messages in a row, the model will treat them as a continuation of the same input (this way works better than combining them into one message, since the tool result specifically mentions (see following user message for image)
				// UPDATE v2.0: we don't use tools anymore, but if we did it's important to note that the openrouter prompt caching mechanism requires one user message at a time, so we would need to add these images to the user content array instead.
				// if (toolResultImages.length > 0) {
				// 	openAiMessages.push({
				// 		role: "user",
				// 		content: toolResultImages.map((part) => ({
				// 			type: "image_url",
				// 			image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` },
				// 		})),
				// 	})
				// }

				// Process non-tool messages
				if (nonToolMessages.length > 0) {
					openAiMessages.push({
						role: "user",
						content: nonToolMessages.map((part) => {
							if (part.type === "image") {
								return {
									type: "image_url",
									image_url: {
										url: `data:${part.source.media_type};base64,${part.source.data}`,
									},
								}
							}
							return { type: "text", text: part.text }
						}),
					})
				}
			} else if (anthropicMessage.role === "assistant") {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolUseBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_use") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						} // assistant cannot send tool_result messages
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process non-tool messages
				let content: string | undefined
				if (nonToolMessages.length > 0) {
					content = nonToolMessages
						.map((part) => {
							if (part.type === "image") {
								return "" // impossible as the assistant cannot send images
							}
							return part.text
						})
						.join("\n")
				}

				// Process tool use messages
				const tool_calls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolMessages.map((toolMessage) => ({
					id: toolMessage.id,
					type: "function",
					function: {
						name: toolMessage.name,
						// json string
						arguments: JSON.stringify(toolMessage.input),
					},
				}))

				openAiMessages.push({
					role: "assistant",
					content,
					// Cannot be an empty array. API expects an array with minimum length 1, and will respond with an error if it's empty
					tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
				})
			}
		}
	}

	// Add planning prompt only for the first message
	if (openAiMessages.length > 0 && !hasInsertedPlanningPromptOnce) {
		if (openAiMessages[0].role === "user") {
			openAiMessages.unshift({
				role: "system",
				content: PLANNING_PROMPT,
			})
		}
	}

	return openAiMessages
}

// Convert OpenAI response to Anthropic format
export function convertToAnthropicMessage(completion: OpenAI.Chat.Completions.ChatCompletion): Anthropic.Messages.Message {
	const openAiMessage = completion.choices[0].message
	const anthropicMessage: Anthropic.Messages.Message = {
		id: completion.id,
		type: "message",
		role: openAiMessage.role, // always "assistant"
		content: [
			{
				type: "text",
				text: openAiMessage.content || "",
				citations: null,
			},
		],
		model: completion.model,
		stop_reason: (() => {
			switch (completion.choices[0].finish_reason) {
				case "stop":
					return "end_turn"
				case "length":
					return "max_tokens"
				case "tool_calls":
					return "tool_use"
				case "content_filter": // Anthropic doesn't have an exact equivalent
				default:
					return null
			}
		})(),
		stop_sequence: null, // which custom stop_sequence was generated, if any (not applicable if you don't use stop_sequence)
		usage: {
			input_tokens: completion.usage?.prompt_tokens || 0,
			output_tokens: completion.usage?.completion_tokens || 0,
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
		},
	}

	if (openAiMessage.tool_calls && openAiMessage.tool_calls.length > 0) {
		anthropicMessage.content.push(
			...openAiMessage.tool_calls.map((toolCall): Anthropic.ToolUseBlock => {
				let parsedInput = {}
				try {
					parsedInput = JSON.parse(toolCall.function.arguments || "{}")
				} catch (error) {
					console.error("Failed to parse tool arguments:", error)
				}
				return {
					type: "tool_use",
					id: toolCall.id,
					name: toolCall.function.name,
					input: parsedInput,
				}
			}),
		)
	}
	return anthropicMessage
}
