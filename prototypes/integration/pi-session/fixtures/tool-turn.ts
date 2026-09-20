import type { TrialEvent, TrialMessage } from "../event-adapter.ts";

// Hand-authored consumed-field fixtures, not a capture from a live model.
export const user: TrialMessage = { role: "user", content: "Read the sample file." };
export function assistant(text: string, stopReason = "pending"): TrialMessage {
  return { role: "assistant", content: [{ type: "text", text }], stopReason };
}
const result: TrialMessage = {
  role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "hello 中文" }],
};

export const toolTurn: readonly TrialEvent[] = [
  { type: "agent_start" },
  { type: "message_start", message: user },
  { type: "message_end", message: user },
  { type: "turn_start" },
  { type: "message_start", message: assistant("") },
  { type: "message_update", message: assistant("Reading") },
  { type: "message_update", message: assistant("Reading the file.") },
  { type: "message_end", message: { ...assistant("Reading the file.", "toolUse"), content: [
    { type: "text", text: "Reading the file." }, { type: "toolCall" },
  ] } },
  { type: "tool_execution_start", toolCallId: "call-1", toolName: "read" },
  { type: "tool_execution_update", toolCallId: "call-1", partialResult: { content: [{ type: "text", text: "hello" }] } },
  { type: "tool_execution_end", toolCallId: "call-1", result: { content: [{ type: "text", text: "hello 中文" }] }, isError: false },
  { type: "message_start", message: result },
  { type: "message_end", message: result },
  { type: "turn_end" },
  { type: "turn_start" },
  { type: "message_start", message: assistant("") },
  { type: "message_update", message: assistant("The file says: hello 中") },
  { type: "message_end", message: assistant("The file says: hello 中文", "stop") },
  { type: "turn_end" },
  { type: "agent_end", willRetry: false },
];

export const expectedTranscript = [
  "User:\nRead the sample file.", "Assistant:\nReading the file.",
  "Tool: read\nhello 中文", "Assistant:\nThe file says: hello 中文",
];
