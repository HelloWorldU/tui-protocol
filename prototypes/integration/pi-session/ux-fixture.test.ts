import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUxSession, Gates, PROMPT, SUMMARY, LATER, INITIAL, CONTINUATION } from "./ux/fixture.ts";
import { transcriptEvent } from "./session-runner.ts";
import { replay } from "./replay.ts";
import type { TrialEvent } from "./event-adapter.ts";
import { semanticEvent } from "./ux/semantic-trace.ts";

test("real Pi parallel tools leave the earlier progress mutable until the later result exists, then replace it with a summary", { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "tui-pi-ux-test-"));
  const gates = new Gates();
  const source = await createUxSession(directory, gates);
  const events: TrialEvent[] = [];
  let laterDone!: () => void;
  const later = new Promise<void>(resolve => { laterDone = resolve; });
  const unsubscribe = source.session.subscribe(event => {
    const selected = transcriptEvent(event);
    if (selected) events.push(structuredClone(selected));
    if (event.type === "tool_execution_end" && event.toolCallId === "later-call") laterDone();
  });
  const run = source.session.prompt(PROMPT);
  try {
    gates.release("stream"); gates.release("tools");
    await later;
    assert(events.some(e => e.type === "tool_execution_update" && e.toolCallId === "slow-call"));
    assert(!events.some(e => e.type === "tool_execution_end" && e.toolCallId === "slow-call"));
    gates.release("shrink"); gates.release("final"); await run;
    const result = await replay(events);
    assert.equal(result.outcome, "completed");
    if (result.outcome !== "completed") throw new Error("Expected completion");
    assert.equal(source.requests(), 2);
    assert.equal(result.context.blocks.length, 5);
    assert.equal(result.context.blocks[1].content.data, `Assistant:\n${INITIAL}${CONTINUATION}`);
    assert.equal(result.context.blocks[2].content.data, `Tool: read_slow_sample\n${SUMMARY}`);
    assert.equal(result.context.blocks[3].content.data, `Tool: read_later_sample\n${LATER}`);
    assert.equal(result.context.state, "closed");
  } finally {
    await source.session.abort(); await run.catch(() => {}); unsubscribe(); source.session.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a cancelled fixture gate rejects its waiter and a later release does not resume it", async () => {
  const gates = new Gates();
  const cancel = new AbortController();
  const pending = gates.wait("shrink", cancel.signal);
  cancel.abort();
  await assert.rejects(pending, /cancelled/);
  gates.release("shrink");
  await gates.wait("shrink");
});

test("trace comparison ignores aggregate end metadata but retains text, tool identity, and failure differences", () => {
  const end = { type: "agent_end", willRetry: false, messages: [{ cwd: "temporary-directory" }] } as const;
  assert.deepEqual(semanticEvent(end), { type: "agent_end", willRetry: false });
  const update = { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "old" }] } } as const;
  const record = semanticEvent(update);
  assert.notDeepEqual(record, semanticEvent({ ...update, message: { role: "assistant", content: "new" } }));
  const tool = { type: "tool_execution_end", toolCallId: "a", result: { content: [{ type: "text", text: "same" }] }, isError: false } as const;
  assert.notDeepEqual(semanticEvent(tool), semanticEvent({ ...tool, toolCallId: "b" }));
  assert.notDeepEqual(semanticEvent(tool), semanticEvent({ ...tool, isError: true }));
});
