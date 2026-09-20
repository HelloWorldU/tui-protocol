import assert from "node:assert/strict";
import test from "node:test";
import { TuiClient } from "@tui-protocol/sdk";
import { TerminalProtocolEndpoint } from "@tui-protocol/terminal";
import { PiEventAdapter } from "./event-adapter.ts";
import { createFixtureModel } from "./fixtures/provider.ts";
import { createTrialSession } from "./session-source.ts";
import { runPiSession } from "./session-runner.ts";

async function setup() {
  const model = await createFixtureModel();
  const source = await createTrialSession(model.runtime, model.model);
  const endpoint = new TerminalProtocolEndpoint({ completeBaselineSupported: true });
  const client = new TuiClient({ write(bytes) {
    const result = endpoint.push(bytes);
    assert.deepEqual(result.diagnostics, []);
    queueMicrotask(() => {
      for (const frame of result.responseFrames) {
        const events = client.receive(frame);
        assert(!events.some(event => event.type === "error" || event.type === "message" && event.message.kind === "protocol.error"));
      }
    });
  } });
  assert(await client.negotiate());
  const context = await client.openContext();
  const adapter = new PiEventAdapter(context);
  return { ...source, ...model, endpoint, client, context, adapter, async cleanup() {
    client.dispose(); await source.dispose();
  } };
}

test("the installed Pi session streams two responses, executes the read-only tool, and closes four Session Blocks", { timeout: 15_000 }, async () => {
  const f = await setup();
  try {
    const seen: string[] = [];
    assert.equal(await runPiSession(f.session, f.adapter, { onEvent: event => { seen.push(event.type); } }), "completed");
    await f.context.close();
    assert.equal(f.requestCount(), 2);
    assert.equal(f.toolCalls(), 1);
    assert(seen.includes("tool_execution_update"));
    assert(seen.includes("agent_settled"));
    const snapshot = f.endpoint.context(f.context.id)!;
    assert.equal(snapshot.state, "closed");
    assert.equal(snapshot.blocks.length, 4);
    assert(snapshot.blocks.every(block => block.lifecycle === "sealed"));
    assert.equal(snapshot.blocks[2].content.data, "Tool: read_trial_sample\nTrial sample: mutable history keeps old output readable.");
    assert(snapshot.blocks[3].content.data.includes("Result: mutable history"));
  } finally { await f.cleanup(); }
});

test("cancelling a real Pi stream retains partial text, stops before tools, and closes its Context", { timeout: 15_000 }, async () => {
  const f = await setup();
  try {
    const stop = new AbortController();
    const outcome = await runPiSession(f.session, f.adapter, { signal: stop.signal, onEvent(event) {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") stop.abort();
    } });
    assert.equal(outcome, "aborted");
    await f.context.close();
    assert.equal(f.requestCount(), 1);
    assert.equal(f.toolCalls(), 0);
    const snapshot = f.endpoint.context(f.context.id)!;
    assert.equal(snapshot.blocks.length, 2);
    assert(snapshot.blocks[1].content.data.includes("Reading\n[aborted]"));
    assert.equal(snapshot.state, "closed");
  } finally { await f.cleanup(); }
});
