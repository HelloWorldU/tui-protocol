import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { ProtocolStreamDecoder } from "@tui-protocol/protocol";
import { TerminalProtocolEndpoint, type AppliedBlockOperation } from "@tui-protocol/terminal";
import { createTrialSession } from "./session-source.ts";
import { runMultiRound } from "./multi-round/application.ts";
import { createMultiRoundModel } from "./multi-round/provider.ts";
import { CommandReader, type Command } from "./multi-round/commands.ts";

function fixture(options: { cancelFirst?: boolean; cancelTool?: boolean; quitActive?: boolean; failPrompt?: string; reject?: boolean;
  unsupported?: boolean; eof?: boolean; burst?: boolean; idle?: boolean; quitIdle?: boolean; cancelImmediately?: boolean;
  deadline?: number; turnDeadline?: number; pauseMs?: number; maxQueuedBytes?: number } = {}) {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode(value: boolean) { this.isRaw = value; } });
  const operations: AppliedBlockOperation[] = [];
  const endpoint = new TerminalProtocolEndpoint({ completeBaselineSupported: !options.unsupported,
    operationAdapter: { prepare: op => options.reject && op.kind === "block.extend" ? "resource_exhausted" : undefined,
      accept: op => { operations.push(op); } } });
  const decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  const send = (command: Command) => input.write(JSON.stringify(command) + "\n");
  let ordinary = "";
  let created = 0; let disposed = 0; let interrupted = false;
  let source: Awaited<ReturnType<typeof createTrialSession>> | undefined;
  const output = Object.assign(new Writable({ write(chunk: Buffer, _encoding, done) {
    try {
      let text = "";
      for (const event of decoder.push(chunk)) if (event.type === "ordinary") text += Buffer.from(event.data).toString("utf8");
      ordinary += text;
      const result = endpoint.push(chunk);
      assert.deepEqual(result.diagnostics, []);
      queueMicrotask(() => {
        for (const frame of result.responseFrames) input.write(frame);
        if (text.includes("[ready 1/") && options.quitIdle) send({ type: "quit" });
        else if (text.includes("[ready 1/") && !options.idle) {
          send({ type: "prompt", text: "first 中文 😀" });
          if (options.cancelImmediately) send({ type: "cancel" });
          if (options.burst) send({ type: "prompt", text: "must not queue" });
        }
        if (text.includes("[ready 2/")) send({ type: "prompt", text: options.failPrompt ?? "second" });
        if (options.cancelTool && !interrupted && endpoint.contexts().some(context =>
          context.blocks.some(block => block.content.data.includes("Reading sample...")))) {
          interrupted = true; send({ type: "cancel" });
        }
        if ((options.cancelFirst || options.quitActive || options.eof) && !interrupted && operations.some(op => op.kind === "block.extend")) {
          interrupted = true;
          if (options.eof) input.end();
          else send({ type: options.quitActive ? "quit" : "cancel" });
        }
      });
      done();
    } catch (error) { done(error as Error); }
  } }), { isTTY: true });
  return { input, output, endpoint, operations, text: () => ordinary, created: () => created, disposed: () => disposed,
    source: () => source,
    run: () => runMultiRound({ input, output, maxRounds: 2, timeoutMs: 100, deadlineMs: options.deadline ?? 5000,
      turnDeadlineMs: options.turnDeadline, maxQueuedBytes: options.maxQueuedBytes,
      createSource: async () => {
        created++;
        const { runtime, model } = await createMultiRoundModel(options.pauseMs ?? 5, options.failPrompt);
        source = await createTrialSession(runtime, model, 5, undefined, { maxToolCalls: 4 });
        return { ...source, async dispose() { disposed++; await source!.dispose(); } };
      } }),
  };
}

test("two entered prompts reuse Pi conversation, execute the read-only tool each round, and close separate Contexts", async () => {
  const f = fixture(); assert.equal(await f.run(), "limit");
  assert.equal(f.created(), 1); assert.equal(f.disposed(), 1); assert.equal(f.source()!.toolCalls(), 2);
  const contexts = f.endpoint.contexts();
  assert.equal(contexts.length, 2); assert.notEqual(contexts[0].id, contexts[1].id);
  for (const context of contexts) {
    assert.equal(context.state, "closed"); assert.equal(context.blocks.length, 4);
    assert(context.blocks.every(block => block.lifecycle === "sealed"));
  }
  assert(contexts[1].blocks[3].content.data.includes("Previous prompt: first 中文 😀"));
  assert.equal(f.input.isRaw, false); assert.equal(f.input.listenerCount("data"), 0);
  assert.equal(f.output.listenerCount("error"), 0);
});

test("cancel retains partial text and a later prompt completes in the same Pi session", async () => {
  const f = fixture({ cancelFirst: true }); assert.equal(await f.run(), "limit");
  const contexts = f.endpoint.contexts(); assert.equal(contexts.length, 2);
  assert.equal(contexts[0].state, "closed"); assert.equal(contexts[0].blocks.length, 2);
  assert(contexts[0].blocks[1].content.data.includes("[aborted]"));
  assert(contexts[1].blocks[3].content.data.includes("Previous prompt: first 中文 😀"));
  assert(f.text().includes("[round 1 aborted]")); assert(f.text().includes("[round 2 completed]"));
  assert.equal(f.source()!.toolCalls(), 1);
});

test("end session during streaming cancels the current turn without accepting another prompt", async () => {
  const f = fixture({ quitActive: true }); assert.equal(await f.run(), "quit");
  assert.equal(f.endpoint.contexts().length, 1); assert.equal(f.endpoint.contexts()[0].state, "closed");
  assert(f.text().includes("[session ended by user]")); assert(!f.text().includes("[ready 2/"));
});

test("cancelling during the sample read settles its result and the next prompt runs in the same Pi conversation", async () => {
  const f = fixture({ cancelTool: true });
  assert.equal(await f.run(), "limit");
  const contexts = f.endpoint.contexts(); assert.equal(contexts.length, 2);
  assert.equal(contexts[0].state, "closed"); assert.equal(contexts[0].blocks.length, 3);
  assert(contexts[0].blocks[2].content.data.includes("[Tool error]"));
  assert(contexts[0].blocks.every(block => block.lifecycle === "sealed"));
  assert.equal(contexts[1].blocks.length, 4); assert.equal(f.source()!.toolCalls(), 2); assert.equal(f.disposed(), 1);
  assert(f.text().includes("[round 1 aborted]")); assert(f.text().includes("[round 2 completed]"));
});

test("a second prompt arriving during a turn is rejected instead of queued for later model use", async () => {
  const f = fixture({ burst: true }); await f.run();
  assert(f.text().includes("[busy: prompt not accepted"));
  assert(!JSON.stringify(f.endpoint.contexts()).includes("must not queue"));
});

test("model failure on the second prompt stops without claiming completion or losing the closed first Context", async () => {
  const f = fixture({ failPrompt: "fail now" }); await assert.rejects(f.run(), /ended with error/);
  assert.equal(f.endpoint.contexts()[0].state, "closed"); assert.equal(f.disposed(), 1);
  assert(!f.text().includes("[round 2 completed]")); assert(!f.text().includes("[trial round limit reached]"));
});

test("terminal rejection or input EOF stops later sends and restores input mode", async () => {
  for (const options of [{ reject: true }, { eof: true }]) {
    const f = fixture(options); await assert.rejects(f.run(), /resource_exhausted|input ended/);
    assert.equal(f.disposed(), 1); assert.equal(f.input.isRaw, false); assert.equal(f.input.listenerCount("data"), 0);
    assert(!f.text().includes("[ready 2/")); assert(!f.text().includes("[round 1 completed]"));
  }
});

test("unsupported negotiation never constructs Pi; an idle deadline disposes the constructed session", async () => {
  const unsupported = fixture({ unsupported: true }); assert.equal(await unsupported.run(), "unsupported");
  assert.equal(unsupported.created(), 0); assert.equal(unsupported.operations.length, 0);
  const idle = fixture({ idle: true, deadline: 500 }); await assert.rejects(idle.run(), /deadline exceeded/);
  assert.equal(idle.disposed(), 1); assert.equal(idle.operations.length, 0);
});

test("split UTF-8 form commands preserve Chinese, emoji, newlines, and escaped control characters", () => {
  const reader = new CommandReader(); const commands: Command[] = [];
  const command: Command = { type: "prompt", text: "中文 😀\n\u001b]9002;literal\u0007" };
  const bytes = Buffer.from(JSON.stringify(command) + "\n");
  for (const byte of bytes) reader.push(new Uint8Array([byte]), value => commands.push(value));
  assert.deepEqual(commands, [command]);
});

test("invalid, oversized, or malformed UTF-8 form commands are rejected", () => {
  const rejectsBeforeDelivery = (bytes: Uint8Array) => {
    let delivered = false;
    assert.throws(() => new CommandReader().push(bytes, () => { delivered = true; }));
    assert.equal(delivered, false);
  };
  for (const line of ['null', '{"type":"prompt","text":""}', '{"type":"prompt","text":"\\ud800"}',
    JSON.stringify({ type: "prompt", text: "a".repeat(2001) }), '{"type":"quit","extra":true}']) {
    rejectsBeforeDelivery(Buffer.from(line + "\n"));
  }
  rejectsBeforeDelivery(new Uint8Array([255, 10]));
  rejectsBeforeDelivery(Buffer.from("x".repeat(12101)));
});

test("quitting while idle creates no display Context and disposes Pi once", async () => {
  const f = fixture({ quitIdle: true }); assert.equal(await f.run(), "quit");
  assert.equal(f.created(), 1); assert.equal(f.disposed(), 1); assert.equal(f.endpoint.contexts().length, 0);
});

test("cancel immediately after submitting skips model output for that turn and accepts the next prompt", async () => {
  const f = fixture({ cancelImmediately: true }); assert.equal(await f.run(), "limit");
  const contexts = f.endpoint.contexts(); assert.equal(contexts.length, 2);
  assert.equal(contexts[0].state, "closed"); assert.equal(contexts[0].blocks.length, 0);
  assert(contexts[1].blocks[3].content.data.includes("prompt 1: second"));
  assert(f.text().includes("[round 1 aborted]"));
});

test("turn deadline cancels a slow producer and stops without offering another round", async () => {
  const f = fixture({ pauseMs: 200, turnDeadline: 50 }); await assert.rejects(f.run(), /turn deadline exceeded/);
  assert.equal(f.disposed(), 1); assert.equal(f.input.isRaw, false); assert(!f.text().includes("[ready 2/"));
});

test("an insufficient output budget rejects negotiation before constructing Pi and restores input mode", async () => {
  const f = fixture({ maxQueuedBytes: 1 }); await assert.rejects(f.run(), /output budget/);
  assert.equal(f.created(), 0); assert.equal(f.input.isRaw, false); assert.equal(f.input.listenerCount("data"), 0);
});
