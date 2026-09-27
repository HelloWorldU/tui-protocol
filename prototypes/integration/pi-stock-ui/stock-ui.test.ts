import assert from "node:assert/strict";
import test from "node:test";
import { prepareStockUiTrial, type PreparedTrial } from "./application.ts";
import { FakeHost } from "./fake-host.ts";
import { createFixtureModel } from "./fixtures/provider.ts";
import { renderGateActive } from "./render-gate.ts";
import { createTrialRuntime, TRIAL_PROMPT, type TrialRuntimeSource } from "./session-source.ts";

async function waitFor(predicate: () => boolean, reason: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${reason}`);
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

/** Rendering is throttled; wait until the chrome byte stream has been quiet. */
async function settleChrome(host: FakeHost): Promise<void> {
  let last = -1;
  let quietSince = Date.now();
  const deadline = Date.now() + 10_000;
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

async function composeTrial(options: { supported?: boolean; protocol?: boolean; pauseMs?: number } = {}) {
  const host = new FakeHost({ supported: options.supported ?? true });
  const pauseMs = options.pauseMs ?? 10;
  const fixture = await createFixtureModel(pauseMs);
  const source = await createTrialRuntime(fixture, pauseMs, { maxToolCalls: 4 });
  const failures: Error[] = [];
  const prepared = await prepareStockUiTrial({
    input: host.input, output: host.output, source,
    protocol: options.protocol,
    stockTerminal: terminal => terminal,
    onFailure: error => failures.push(error),
  });
  return { host, source, prepared, failures };
}

async function teardown(prepared: PreparedTrial, source: TrialRuntimeSource): Promise<void> {
  try { prepared.interactiveMode.stop(); } catch { /* tolerate a stopped UI */ }
  try { prepared.client?.dispose(); } catch { /* already disposed */ }
  await source.dispose();
}

test("trial flag off: no protocol bytes cross and the transcript renders in the chrome stream", async () => {
  const { host, source, prepared, failures } = await composeTrial({ protocol: false });
  try {
    assert.equal(prepared.mode, "stock");
    await prepared.interactiveMode.init();
    await source.runtime.session.prompt(TRIAL_PROMPT);
    await settleChrome(host);
    assert.deepEqual(host.messageKinds, []);
    assert.equal(host.contexts().length, 0);
    assert.equal(renderGateActive(), false);
    assert(host.chrome.includes("[pi-stock-ui] protocol disabled by trial flag"));
    assert(host.chrome.includes("Result: mutable history keeps old output readable."));
    assert(host.chrome.includes("brief answer"));
    assert.deepEqual(failures, []);
  } finally {
    await teardown(prepared, source);
  }
});

test("negotiation negative: only the capability query crosses, no Context opens, transcript stays in chrome", async () => {
  const { host, source, prepared, failures } = await composeTrial({ supported: false });
  try {
    assert.equal(prepared.mode, "stock");
    await prepared.interactiveMode.init();
    await source.runtime.session.prompt(TRIAL_PROMPT);
    await settleChrome(host);
    assert.deepEqual(host.messageKinds, ["capability.query"]);
    assert.equal(host.contexts().length, 0);
    assert.equal(renderGateActive(), false);
    assert(host.chrome.includes("[pi-stock-ui] protocol unsupported by this terminal"));
    assert(host.chrome.includes("Result: mutable history keeps old output readable."));
    assert.deepEqual(failures, []);
  } finally {
    await teardown(prepared, source);
  }
});

test("negotiation positive: the transcript seals into Blocks and the chrome stream carries no transcript text", async () => {
  const { host, source, prepared, failures } = await composeTrial({ supported: true });
  try {
    assert.equal(prepared.mode, "protocol");
    await prepared.interactiveMode.init();
    await source.runtime.session.prompt(TRIAL_PROMPT);
    await prepared.bridge!.drain();
    await settleChrome(host);
    assert.deepEqual(failures, []);
    assert.deepEqual(host.diagnostics, []);
    assert.equal(renderGateActive(), true);
    const contexts = host.contexts();
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].state, "closed");
    const blocks = contexts[0].blocks;
    assert.deepEqual(blocks.map(block => block.id), ["pi-1", "pi-2", "pi-3", "pi-4"]);
    assert(blocks.every(block => block.lifecycle === "sealed"));
    assert.equal(blocks[0].content.data, `User:\n${TRIAL_PROMPT}`);
    assert.equal(blocks[1].content.data, "Assistant:\nReading the local sample.");
    assert.equal(blocks[2].content.data, "Tool: read_trial_sample\nTrial sample: mutable history keeps old output readable.");
    assert.equal(blocks[3].content.data,
      "Assistant:\nResult: mutable history keeps old output readable.\nThe read_trial_sample tool returned the sample.");
    assert(!host.chrome.includes("Reading the local sample"), "assistant text leaked into chrome");
    assert(!host.chrome.includes("Result: mutable history"), "assistant result text leaked into chrome");
    assert(!host.chrome.includes("Trial sample: mutable history"), "tool result leaked into chrome");
    assert(!host.chrome.includes("brief answer"), "user prompt leaked into chrome");
    assert(host.chrome.includes("[pi-stock-ui] protocol supported"));
    assert(host.chrome.includes("\x1b["), "chrome stream carries no ANSI drawing");
  } finally {
    await teardown(prepared, source);
  }
});

test("cancel mid-stream seals the partial assistant Block with an abort label, and a second turn completes", async () => {
  const { host, source, prepared, failures } = await composeTrial({ supported: true, pauseMs: 200 });
  try {
    await prepared.interactiveMode.init();
    const first = source.runtime.session.prompt(TRIAL_PROMPT);
    await waitFor(() => host.contexts()[0]?.blocks.some(block => block.id === "pi-2" && block.lifecycle === "mutable") === true,
      "the assistant Block to be streaming");
    host.send("\x1b");
    await first;
    await prepared.bridge!.drain();
    await settleChrome(host);
    assert.deepEqual(failures, []);
    const firstContext = host.contexts()[0];
    assert.equal(firstContext.state, "closed");
    const partial = firstContext.blocks.find(block => block.id === "pi-2");
    assert.equal(partial?.lifecycle, "sealed");
    assert(partial?.content.data.includes("[aborted]"), `missing abort label: ${partial?.content.data}`);
    assert(!firstContext.blocks.some(block => block.id === "pi-3"), "the tool ran despite the cancellation");

    await source.runtime.session.prompt(TRIAL_PROMPT);
    await prepared.bridge!.drain();
    await settleChrome(host);
    assert.deepEqual(failures, []);
    assert.equal(host.contexts().length, 2);
    const second = host.contexts()[1];
    assert.equal(second.state, "closed");
    assert.deepEqual(second.blocks.map(block => block.id), ["pi-1", "pi-2", "pi-3", "pi-4"]);
    assert(second.blocks.every(block => block.lifecycle === "sealed"));
    assert.equal(second.blocks[3].content.data,
      "Assistant:\nResult: mutable history keeps old output readable.\nThe read_trial_sample tool returned the sample.");
  } finally {
    await teardown(prepared, source);
  }
});

test("typing into the editor during streaming reaches Pi and appears in the chrome stream", async () => {
  const { host, source, prepared, failures } = await composeTrial({ supported: true, pauseMs: 150 });
  try {
    await prepared.interactiveMode.init();
    const prompting = source.runtime.session.prompt(TRIAL_PROMPT);
    await waitFor(() => host.messageKinds.includes("context.open"), "the turn Context to open");
    host.send("hello");
    await prompting;
    await prepared.bridge!.drain();
    await settleChrome(host);
    assert.deepEqual(failures, []);
    assert(host.chrome.includes("hello"), "editor echo missing from chrome");
    const blocks = host.contexts()[0].blocks;
    assert.equal(blocks.length, 4);
    assert(!blocks.some(block => block.content.data.includes("hello")), "editor input leaked into a Block");
  } finally {
    await teardown(prepared, source);
  }
});

test("resize re-renders chrome at the new width without disturbing sealed Block state", async () => {
  const { host, source, prepared, failures } = await composeTrial({ supported: true });
  try {
    await prepared.interactiveMode.init();
    await source.runtime.session.prompt(TRIAL_PROMPT);
    await prepared.bridge!.drain();
    await settleChrome(host);
    const baselineChrome = host.chrome.length;
    host.resize(36, 24);
    await waitFor(() => host.chrome.length > baselineChrome, "a chrome repaint after resize");
    await settleChrome(host);
    host.resize(80, 24);
    await settleChrome(host);
    assert.deepEqual(failures, []);
    assert.deepEqual(host.diagnostics, []);
    const context = host.contexts()[0];
    assert.equal(context.state, "closed");
    assert.deepEqual(context.blocks.map(block => block.id), ["pi-1", "pi-2", "pi-3", "pi-4"]);
    assert(context.blocks.every(block => block.lifecycle === "sealed"));
  } finally {
    await teardown(prepared, source);
  }
});
