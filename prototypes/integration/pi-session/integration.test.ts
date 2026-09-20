import assert from "node:assert/strict";
import test from "node:test";
import { replay } from "./replay.ts";
import { assistant, expectedTranscript, toolTurn, user } from "./fixtures/tool-turn.ts";

test("fixed Pi-shaped events cross SDK bytes and Session into four sealed Blocks in a closed Context", async () => {
  const result = await replay(toolTurn);
  assert.equal(result.outcome, "completed");
  if (result.outcome !== "completed") return;
  assert.equal(result.context.state, "closed");
  assert.deepEqual(result.context.blocks.map(block => block.content.data), expectedTranscript);
  assert(result.context.blocks.every(block => block.lifecycle === "sealed"));
  assert.deepEqual(result.context.blocks.map(block => block.id), ["pi-1", "pi-2", "pi-3", "pi-4"]);
  assert(result.operations.some(operation => operation.kind === "block.extend"));
  assert(result.operations.some(operation => operation.kind === "block.replace_suffix"));
});

test("an unsupported responder receives no Block Operations and does not consume fixture events", async () => {
  const result = await replay([{ type: "message_update", message: assistant("would fail if consumed") }], { supported: false });
  assert.deepEqual(result, { outcome: "unsupported", operations: [] });
});

test("rejecting the first streamed Extend returns an encoded error and stops subsequent events", async () => {
  const attempted: string[] = [];
  await assert.rejects(replay(toolTurn, { rejectOperation(operation) {
    attempted.push(operation.kind);
    return operation.kind === "block.extend" ? "resource_exhausted" : undefined;
  } }), /Terminal rejected Operation: resource_exhausted/);
  assert.deepEqual(attempted, ["block.append", "block.append", "block.extend"]);
});

test("an aborted assistant keeps partial content and an abort label through the real codec and Session", async () => {
  const result = await replay([
    { type: "agent_start" },
    { type: "message_start", message: user },
    { type: "message_end", message: user },
    { type: "message_start", message: assistant("Partial 😀") },
    { type: "message_end", message: assistant("Partial 😀", "aborted") },
    { type: "agent_end", willRetry: false },
  ]);
  assert.equal(result.outcome, "completed");
  if (result.outcome === "completed") {
    assert.equal(result.context.blocks[1].content.data, "Assistant:\nPartial 😀\n[aborted]");
    assert.equal(result.context.blocks[1].lifecycle, "sealed");
  }
});

test("a suffix correction after an astral character reaches Session without cutting that character", async () => {
  const result = await replay([
    { type: "agent_start" },
    { type: "message_start", message: user },
    { type: "message_end", message: user },
    { type: "message_start", message: assistant("A😀old") },
    { type: "message_end", message: assistant("A😀new", "stop") },
    { type: "agent_end", willRetry: false },
  ]);
  assert.equal(result.outcome, "completed");
  if (result.outcome === "completed") assert.equal(result.context.blocks[1].content.data, "Assistant:\nA😀new");
});

test("truncated fixtures fail rather than reporting a completed Context", async () => {
  await assert.rejects(replay(toolTurn.slice(0, -1)), /before agent_end/);
});

test("a rejected final content write fails the run even when Seal was already sent in the same event", async () => {
  const attempted: string[] = [];
  await assert.rejects(replay([
    { type: "agent_start" },
    { type: "message_start", message: user },
    { type: "message_end", message: user },
    { type: "message_start", message: assistant("partial") },
    { type: "message_end", message: assistant("partial final", "stop") },
    { type: "agent_end", willRetry: false },
  ], { rejectOperation(operation) {
    attempted.push(operation.kind);
    return operation.kind === "block.extend" ? "resource_exhausted" : undefined;
  } }), /resource_exhausted/);
  // No success acknowledgement exists: stop means no future sends once the error arrives,
  // not that a following Operation already handed to the transport can be recalled.
  assert.deepEqual(attempted, ["block.append", "block.append", "block.extend", "block.seal"]);
});

test("tool result snapshots replace prior text and a final tool error is shown once", async () => {
  const events = toolTurn.map(event => event.type === "tool_execution_end" ? {
    ...event, result: { content: [{ type: "text", text: "denied" }] }, isError: true,
  } : (event.type === "message_start" || event.type === "message_end") && event.message.role === "toolResult" ? {
    ...event, message: { ...event.message, content: [{ type: "text", text: "denied" }] },
  } : event);
  const result = await replay(events);
  assert.equal(result.outcome, "completed");
  if (result.outcome === "completed") {
    assert.equal(result.context.blocks[2].content.data, "Tool: read\ndenied\n[Tool error]");
    assert.equal(result.context.blocks.length, 4);
  }
});
