import assert from "node:assert/strict";
import test from "node:test";
import { PiEventAdapter, DEFAULT_TRIAL_LIMITS, type BlockWriter, type TrialEvent, type TrialLimits } from "./event-adapter.ts";
import { assistant, user, toolTurn } from "./fixtures/tool-turn.ts";

function fixture(limits?: TrialLimits) {
  const calls: { method: string; args: unknown[]; id: string }[] = [];
  const writer: BlockWriter = {
    append: (...args) => record("append", args),
    extend: (...args) => record("extend", args),
    replaceSuffix: (...args) => record("replaceSuffix", args),
    seal: (...args) => record("seal", args),
  };
  function record(method: string, args: unknown[]): string {
    const id = String(calls.length + 1);
    calls.push({ method, args, id });
    return id;
  }
  const adapter = new PiEventAdapter(writer, limits);
  return { adapter, calls, writer };
}

function start(f: ReturnType<typeof fixture>, text = "") {
  f.adapter.accept({ type: "agent_start" });
  f.adapter.accept({ type: "message_start", message: user });
  f.adapter.accept({ type: "message_end", message: user });
  f.adapter.accept({ type: "message_start", message: assistant(text) });
}

test("one tool turn creates four Blocks and does not duplicate toolResult messages", () => {
  const f = fixture();
  for (const event of toolTurn) f.adapter.accept(event);
  assert.equal(f.adapter.state, "finished");
  assert.deepEqual(f.calls.filter(call => call.method === "append").map(call => call.args), [
    ["pi-1", "User:\nRead the sample file.", "sealed"],
    ["pi-2", "Assistant:\n", "mutable"],
    ["pi-3", "Tool: read\n[Running]", "mutable"],
    ["pi-4", "Assistant:\n", "mutable"],
  ]);
  assert.deepEqual(f.calls.filter(call => call.method === "seal").map(call => call.args), [["pi-2"], ["pi-3"], ["pi-4"]]);
});

test("unchanged snapshots send nothing and Extend uses the last content Operation ID", () => {
  const f = fixture();
  start(f, "a");
  f.adapter.accept({ type: "message_update", message: assistant("a") });
  assert.equal(f.calls.length, 2);
  f.adapter.accept({ type: "message_update", message: assistant("ab") });
  f.adapter.accept({ type: "message_update", message: assistant("abc") });
  assert.deepEqual(f.calls.slice(2).map(call => call.args), [["pi-2", "2", "b"], ["pi-2", "3", "c"]]);
});

test("a corrected suffix counts Unicode scalars instead of splitting a surrogate pair", () => {
  const f = fixture();
  start(f, "A😀old");
  f.adapter.accept({ type: "message_update", message: assistant("A😀new") });
  assert.deepEqual(f.calls.at(-1), { method: "replaceSuffix", id: "3", args: ["pi-2", "2", 13, "new"] });
  f.adapter.accept({ type: "message_update", message: assistant("A😀") });
  assert.deepEqual(f.calls.at(-1)?.args, ["pi-2", "3", 13, ""]);
});

test("thinking is shown as fixed plain text and an aborted response keeps its partial content before Seal", () => {
  const f = fixture();
  start(f);
  f.adapter.accept({ type: "message_end", message: {
    role: "assistant", content: [{ type: "thinking", thinking: "Consider" }, { type: "text", text: "Partial" }],
    stopReason: "aborted",
  } });
  assert.deepEqual(f.calls.at(-2)?.args, ["pi-2", "2", "[Thinking]\nConsider\n\nPartial\n[aborted]"]);
  assert.equal(f.calls.at(-1)?.method, "seal");
  f.adapter.accept({ type: "agent_end", willRetry: false });
  assert.equal(f.adapter.state, "finished");
});

test("an image stops the adapter before changing the Block and later events cannot write", () => {
  const f = fixture();
  start(f, "text");
  assert.throws(() => f.adapter.accept({ type: "message_update", message: {
    role: "assistant", content: [{ type: "image" }],
  } }), /Unsupported content/);
  assert.equal(f.calls.length, 2);
  assert.throws(() => f.adapter.accept({ type: "message_update", message: assistant("later") }), /Unsupported content/);
  assert.equal(f.calls.length, 2);
  assert.equal(f.adapter.state, "failed");
});

test("a failed write stops later events without retrying or advancing to Seal", () => {
  const f = fixture();
  start(f);
  f.writer.extend = () => { throw new Error("writer failed"); };
  assert.throws(() => f.adapter.accept({ type: "message_end", message: assistant("done", "stop") }), /writer failed/);
  assert.throws(() => f.adapter.accept({ type: "agent_end", willRetry: false }), /writer failed/);
  assert.equal(f.calls.length, 2);
});

test("an asynchronous rejection stops later sends even after a local run reached agent_end", () => {
  const f = fixture();
  for (const event of toolTurn) f.adapter.accept(event);
  const count = f.calls.length;
  f.adapter.fail(new Error("late terminal rejection"));
  assert.equal(f.adapter.state, "failed");
  assert.throws(() => f.adapter.accept({ type: "agent_start" }), /late terminal rejection/);
  assert.equal(f.calls.length, count);
});

test("duplicate tool IDs and a retrying agent_end stop rather than replaying old content", () => {
  for (const bad of [
    { type: "tool_execution_start", toolCallId: "call-1", toolName: "read" },
    { type: "agent_end", willRetry: true },
  ] satisfies TrialEvent[]) {
    const f = fixture();
    for (const event of toolTurn.slice(0, -1)) f.adapter.accept(event);
    const count = f.calls.length;
    assert.throws(() => f.adapter.accept(bad), /Duplicate|Retry/);
    assert.equal(f.calls.length, count);
  }
});

test("missing message starts, unfinished runs, and unknown events stop without inventing output", () => {
  for (const bad of [
    { type: "message_update", message: assistant("unexpected") },
    { type: "agent_end", willRetry: false },
    { type: "compaction_start" } as unknown as TrialEvent,
  ] satisfies TrialEvent[]) {
    const f = fixture();
    f.adapter.accept({ type: "agent_start" });
    assert.throws(() => f.adapter.accept(bad));
    assert.equal(f.adapter.state, "failed");
    assert.deepEqual(f.calls, []);
  }
});

test("local event, Block, and text limits reject before the next Operation is emitted", () => {
  for (const limits of [
    { ...DEFAULT_TRIAL_LIMITS, maxEvents: 3 },
    { ...DEFAULT_TRIAL_LIMITS, maxBlocks: 1 },
    { ...DEFAULT_TRIAL_LIMITS, maxTextUnits: 30 },
  ]) {
    const f = fixture(limits);
    f.adapter.accept({ type: "agent_start" });
    f.adapter.accept({ type: "message_start", message: user });
    f.adapter.accept({ type: "message_end", message: user });
    assert.throws(() => f.adapter.accept({ type: "message_start", message: assistant("x".repeat(31)) }), /limit exceeded/);
    assert.equal(f.calls.length, 1);
  }
});

test("unpaired surrogates are rejected before output and invalid budgets cannot create an adapter", () => {
  const f = fixture();
  start(f);
  assert.throws(() => f.adapter.accept({ type: "message_update", message: assistant("\ud800") }), /surrogate/);
  assert.equal(f.calls.length, 2);
  assert.throws(() => fixture({ ...DEFAULT_TRIAL_LIMITS, maxEvents: 0 }), /positive safe integers/);
});

test("agent_end cannot report completion while a tool call still has no final result", () => {
  const f = fixture();
  for (const event of toolTurn.slice(0, 9)) f.adapter.accept(event);
  const count = f.calls.length;
  assert.throws(() => f.adapter.accept({ type: "agent_end", willRetry: false }), /incomplete/);
  assert.equal(f.adapter.state, "failed");
  assert.equal(f.calls.length, count);
});
