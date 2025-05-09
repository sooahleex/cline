export type AssistantMessageContent = TextContent | ToolUse

export { parseAssistantMessage } from "./parse-assistant-message"

export interface TextContent {
	type: "text"
	content: string
	partial: boolean
}

export const toolUseNames = [
	"execute_command",
	"read_file",
	"write_to_file",
	"replace_in_file",
	"search_files",
	"list_files",
	"list_code_definition_names",
	"browser_action",
	"use_mcp_tool",
	"access_mcp_resource",
	"ask_followup_question",
	"plan_mode_respond",
	"load_mcp_documentation",
	"attempt_completion",
	"new_task",
] as const

// Converts array of tool call names into a union type ("execute_command" | "read_file" | ...)
export type ToolUseName = (typeof toolUseNames)[number]

export const toolParamNames = [
	"command",
	"requires_approval",
	"path",
	"content",
	"diff",
	"regex",
	"file_pattern",
	"recursive",
	"action",
	"url",
	"coordinate",
	"text",
	"server_name",
	"tool_name",
	"arguments",
	"uri",
	"question",
	"options",
	"response",
	"result",
	"context",
] as const

export type ToolParamName = (typeof toolParamNames)[number]

export interface ToolUse {
	type: "tool_use"
	name: ToolUseName
	// params is a partial record, allowing only some or none of the possible parameters to be used
	params: Partial<Record<ToolParamName, string>>
	partial: boolean
}

export type PhaseStatus = 'pending' | 'approved';

export interface Phase {
  index: number;            // 1부터 시작하는 Phase 번호
  thinking: string;         // <thinking>…</thinking> 콘텐츠
  paths: string[];          // 이 Phase에서 다룰 파일 경로들
  status: PhaseStatus;      // 'pending' 또는 'approved'
}

const TAG_REGEX = /<(thinking|path)>([\s\S]*?)<\/\1>/g;

export function parsePhases(raw: string): Phase[] {
	const phases: Phase[] = [];
	let current: Phase | null = null;
	let match: RegExpExecArray | null;
  
	while ((match = TAG_REGEX.exec(raw)) !== null) {
	  const [ , tag, content ] = match;
	  const text = content.trim();
  
	  if (tag === 'thinking') {
		current = {
		  index: phases.length + 1,
		  thinking: text,
		  paths: [],
		  status: 'pending',
		};
		phases.push(current);
	  } else if (tag === 'path' && current) {
		current.paths.push(text);
	  }
	}
  
	return phases;
}

/**
 * 어시스턴트 메시지에서 <thinking> 블록과 <path> 태그 내용을 추출합니다.
 */
export interface ThoughtWithPaths {
  thinking: string;
  paths: string[];
}
/**
 * 어시스턴트 메시지 문자열에서 <thinking> 태그와 <path> 태그 내용을 추출합니다.
 */
export function extractThinkingWithPaths(assistantMessage: string): ThoughtWithPaths[] {
	// thinking 또는 path 둘 다 한 번에 잡아내는 정규식
	const tagRegex = /<(thinking|path)>([\s\S]*?)<\/\1>/g;
  
	const result: ThoughtWithPaths[] = [];
	let current: ThoughtWithPaths | null = null;
	let match: RegExpExecArray | null;
  
	while ((match = tagRegex.exec(assistantMessage)) !== null) {
	  const tag = match[1];           // 'thinking' 또는 'path'
	  const content = match[2].trim();
  
	  if (tag === 'thinking') {
		// 새로운 thinking 등장 → 그룹 시작
		current = { thinking: content, paths: [] };
		result.push(current);
	  } else if (tag === 'path') {
		// path는 마지막 thinking 그룹에 추가
		if (current) {
		  current.paths.push(content);
		}
		// 만약 current가 null이면, 첫 thinking 이전에 path가 있었단 의미이므로 무시하거나 별도로 처리 가능
	  }
	}
  
	return result;
  }

export { PhaseTracker } from './phase-tracker';
