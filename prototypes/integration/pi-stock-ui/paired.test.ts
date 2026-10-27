import assert from "node:assert/strict";
import test from "node:test";
import { createPairedTrial } from "./paired.ts";
import { FakeHost } from "./fake-host.ts";
import { createFixtureModel } from "./fixtures/provider.ts";
import { renderGateActive } from "./render-gate.ts";
import { createTrialRuntime, TRIAL_PROMPT } from "./session-source.ts";

async function waitFor(predicate: () => boolean, reason: string): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${reason}`);
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

async function settleChrome(host: { chrome: string }): Promise<void> {
  let last = -1;
  let quietSince = Date.now();
  const deadline = Date.now() + 10000;
  for (;;) {
    const current = host.chrome.length;
    if (current !== last) {
      last = current;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= 150) {
      return;
    }
    if (Date.now() > deadline) throw new Error("Chrome output did not settle");
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

test("one runtime renders stock and protocol views with one tool call and four sealed Blocks", async () => {
  const fixture = await createFixtureModel(100);
  const source = await createTrialRuntime(fixture, 100, { maxToolCalls: 4 });
  const stockHost = new FakeHost();
  const protocolHost = new FakeHost();
  const failures: Error[] = [];
  const previousGate = renderGateActive();
  const pair = await createPairedTrial({
    source,
    stockInput: stockHost.input,
    stockOutput: stockHost.output,
    protocolInput: protocolHost.input,
    protocolOutput: protocolHost.output,
    onFailure: error => failures.push(error),
  });
  try {
    assert.notEqual(pair.stock.interactiveMode, pair.protocol.interactiveMode);
    assert.equal(pair.source.runtime, source.runtime);
    assert.equal(pair.stock.mode, "stock");
    assert.equal(pair.protocol.mode, "protocol");
    await pair.init();
    const prompting = source.runtime.session.prompt(TRIAL_PROMPT);
    await waitFor(() => protocolHost.messageKinds.includes("context.open"), "the Context to open");
    protocolHost.send("hello");
    await prompting;
    await waitFor(() => source.toolCalls() === 1 && pair.protocol.bridge!.closedContexts === 1,
      "one tool call and one closed Context");
    await pair.protocol.bridge!.drain();
    await settleChrome(stockHost);
    await settleChrome(protocolHost);

    assert.equal(source.toolCalls(), 1);
    assert.deepEqual(stockHost.messageKinds, []);
    assert(stockHost.chrome.includes("Result: mutable history keeps old output readable."));
    assert(stockHost.chrome.includes("Reading the local sample."));
    assert(stockHost.chrome.includes("brief answer"));
    assert(!stockHost.chrome.includes("hello"), "protocol keyboard input reached the stock view");
    assert(protocolHost.chrome.includes("hello"), "protocol keyboard input did not reach the protocol editor");
    assert(!protocolHost.chrome.includes("Result: mutable history"));
    assert(!protocolHost.chrome.includes("Reading the local sample"));
    assert(!protocolHost.chrome.includes("brief answer"));
    const contexts = protocolHost.contexts();
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].state, "closed");
    assert.deepEqual(contexts[0].blocks.map(block => block.id), ["pi-1", "pi-2", "pi-3", "pi-4"]);
    assert(contexts[0].blocks.every(block => block.lifecycle === "sealed"));
    assert(renderGateActive(), "protocol rendering remains the default after a stock render");
    assert.deepEqual(failures, []);
  } finally {
    await pair.stop();
    assert.equal(renderGateActive(), previousGate);
  }
});
