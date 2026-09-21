import type { TrialEvent } from "../event-adapter.ts";

/** Compare the presentation inputs, not duplicated agent_end history or temporary cwd metadata. */
export function semanticEvent(event: TrialEvent): TrialEvent {
  switch (event.type) {
    case "agent_start": case "turn_start": case "turn_end": return { type: event.type };
    case "agent_end": return { type: event.type, willRetry: event.willRetry };
    case "message_start": case "message_update": case "message_end": return { type: event.type, message: structuredClone({
      role: event.message.role, content: event.message.content, stopReason: event.message.stopReason,
      errorMessage: event.message.errorMessage, toolCallId: event.message.toolCallId,
    }) };
    case "tool_execution_start": return { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName };
    case "tool_execution_update": return { type: event.type, toolCallId: event.toolCallId, partialResult: { content: structuredClone(event.partialResult.content) } };
    case "tool_execution_end": return { type: event.type, toolCallId: event.toolCallId, result: { content: structuredClone(event.result.content) }, isError: event.isError };
  }
}
