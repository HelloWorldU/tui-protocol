import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { ProtocolStreamDecoder } from "@tui-protocol/protocol";
import { TerminalProtocolEndpoint, type AppliedBlockOperation } from "@tui-protocol/terminal";
import { runApplication } from "./application.ts";
import { createFixtureModel } from "./fixtures/provider.ts";
import { createTrialSession } from "./session-source.ts";

function fixture(options: { supported?: boolean; cancel?: boolean; reject?: boolean; redirected?: boolean; endInput?: boolean; idle?: boolean; deadlineMs?: number } = {}) {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode(raw: boolean) { this.isRaw = raw; } });
  const operations: AppliedBlockOperation[] = [];
  const endpoint = new TerminalProtocolEndpoint({ completeBaselineSupported: options.supported ?? true, operationAdapter: {
    prepare: operation => options.reject && operation.kind === "block.extend" ? "resource_exhausted" : undefined,
    accept: operation => { operations.push(operation); },
  } });
  const decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  let ordinary = "";
  let created = 0;
  let disposed = 0;
  let cancelled = false;
  const output = Object.assign(new Writable({ write(chunk: Buffer, _encoding, done) {
    try {
      for (const event of decoder.push(chunk)) if (event.type === "ordinary") ordinary += Buffer.from(event.data).toString("utf8");
      const result = endpoint.push(chunk);
      assert.deepEqual(result.diagnostics, []);
      queueMicrotask(() => {
        for (const frame of result.responseFrames) input.write(frame);
        if (chunk.toString().includes("[ready]") && !options.idle) input.write("n");
        if (options.endInput && !cancelled && operations.some(operation => operation.kind === "block.extend")) {
          cancelled = true; input.end();
        }
        if (options.cancel && !cancelled && operations.some(operation => operation.kind === "block.extend")) {
          cancelled = true; input.write("q");
        }
      });
      done();
    } catch (error) { done(error as Error); }
  } }), { isTTY: !options.redirected });
  return { input, output, endpoint, operations, text: () => ordinary,
    created: () => created, disposed: () => disposed,
    run: () => runApplication({ input, output, timeoutMs: 100, deadlineMs: options.deadlineMs ?? 5000, createSource: async () => {
      created++;
      const { runtime, model } = await createFixtureModel();
      const source = await createTrialSession(runtime, model);
      return { ...source, async dispose() { disposed++; await source.dispose(); } };
    } }),
  };
}

test("the application negotiates, runs the installed Pi session, closes explicitly, and restores input mode", { timeout: 10_000 }, async () => {
  const f = fixture();
  assert.equal(await f.run(), "completed");
  assert(f.text().includes("[Pi turn complete]"));
  assert.equal(f.endpoint.contexts()[0].state, "closed");
  assert.equal(f.disposed(), 1);
  assert.equal(f.input.isRaw, false);
  assert.equal(f.input.listenerCount("data"), 0);
  assert.equal(f.output.listenerCount("error"), 0);
});

test("ordinary q input cancels Pi without being confused with protocol replies and retains partial content", { timeout: 10_000 }, async () => {
  const f = fixture({ cancel: true });
  assert.equal(await f.run(), "aborted");
  assert(f.text().includes("[stopped by user]"));
  assert(!f.text().includes("[Pi turn complete]"));
  const context = f.endpoint.contexts()[0];
  assert.equal(context.state, "closed");
  assert.equal(context.blocks.length, 2);
  assert(context.blocks[1].content.data.includes("[aborted]"));
  assert.equal(f.disposed(), 1);
  assert.equal(f.input.isRaw, false);
});

test("unsupported or redirected output never creates a Pi session and sends no Block Operations", async () => {
  for (const options of [{ supported: false }, { redirected: true }]) {
    const f = fixture(options);
    assert.equal(await f.run(), "unsupported");
    assert.equal(f.created(), 0);
    assert.deepEqual(f.operations, []);
    assert(f.text().includes("no session was started"));
    assert.equal(f.input.isRaw, false);
  }
});

test("terminal rejection aborts the Pi producer, removes handlers, and never switches to fallback", { timeout: 10_000 }, async () => {
  const f = fixture({ reject: true });
  await assert.rejects(f.run(), /resource_exhausted/);
  assert.deepEqual(f.operations.map(operation => operation.kind), ["block.append", "block.append"]);
  assert.equal(f.disposed(), 1);
  assert.equal(f.input.isRaw, false);
  assert.equal(f.input.listenerCount("data"), 0);
  assert(!f.text().includes("[Pi turn complete]") && !f.text().includes("unsupported"));
});

test("an output budget too small for negotiation stops before creating any Pi session", async () => {
  const f = fixture();
  await assert.rejects(runApplication({ input: f.input, output: f.output, maxQueuedBytes: 1,
    createSource: async () => { throw new Error("must not create source"); },
  }), /output budget/);
  assert.equal(f.input.isRaw, false);
  assert.equal(f.input.listenerCount("data"), 0);
});

test("input EOF during streaming fails the run, disposes Pi, and never reports completion", { timeout: 10_000 }, async () => {
  const f = fixture({ endInput: true });
  await assert.rejects(f.run(), /input ended/);
  assert.equal(f.disposed(), 1);
  assert.equal(f.input.isRaw, false);
  assert.equal(f.input.listenerCount("data"), 0);
  assert(!f.text().includes("[Pi turn complete]"));
  assert.equal(f.operations.filter(operation => operation.kind === "block.append").length, 2);
});

test("the application deadline ends the idle prompt without sending Block Operations", { timeout: 10_000 }, async () => {
  const f = fixture({ idle: true, deadlineMs: 1000 });
  await assert.rejects(f.run(), /deadline exceeded/);
  assert.deepEqual(f.operations, []);
  assert.equal(f.disposed(), 1);
  assert.equal(f.input.isRaw, false);
  assert.equal(f.input.listenerCount("data"), 0);
});
