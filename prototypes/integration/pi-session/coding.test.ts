import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { ProtocolStreamDecoder } from "@tui-protocol/protocol";
import { TerminalProtocolEndpoint, type AppliedBlockOperation } from "@tui-protocol/terminal";
import { createCodingWorkspace } from "./coding/workspace.ts";
import { createCodingSource, CODING_LIMITS, CODING_PROMPT, FOLLOWUP_PROMPT } from "./coding/source.ts";
import { createCodingModel } from "./coding/provider.ts";
import { runMultiRound } from "./multi-round/application.ts";

test("the generated cart fails three real tests, an exact edit fixes all six, and disposal removes only its directory", async () => {
  const workspace = await createCodingWorkspace();
  const template = await readFile(new URL("./coding/fixtures/total.mjs", import.meta.url), "utf8");
  try {
    const before = await workspace.runTests();
    assert.equal(before.exitCode, 1); assert.match(before.output, /3 passed, 3 failed/);
    const tests = await workspace.read("total.test.mjs");
    await workspace.replace("sum + item.priceCents", "sum + item.priceCents * item.quantity");
    const after = await workspace.runTests();
    assert.equal(after.exitCode, 0); assert.match(after.output, /6 passed, 0 failed/);
    assert.equal(await workspace.read("total.test.mjs"), tests);
    assert.equal(await readFile(new URL("./coding/fixtures/total.mjs", import.meta.url), "utf8"), template);
  } finally { await workspace.dispose(); }
  await assert.rejects(access(workspace.directory), { code: "ENOENT" });
  await assert.rejects(workspace.read("total.mjs"), /closed/);
});

test("unknown paths, ambiguous replacements, invalid Unicode, and oversized edits leave the sample unchanged", async () => {
  const workspace = await createCodingWorkspace();
  try {
    const original = await workspace.read("total.mjs");
    for (const name of ["../total.mjs", "C:/Windows/win.ini", "total.mjs:stream", "other.mjs"]) {
      await assert.rejects(workspace.read(name), /Only total/);
    }
    for (const [oldText, newText] of [["", "x"], ["missing", "x"], ["item", "x"], ["sum", "x".repeat(8193)], ["sum", "\ud800"]]) {
      await assert.rejects(workspace.replace(oldText, newText));
      assert.equal(await workspace.read("total.mjs"), original);
    }
    const cancel = new AbortController(); cancel.abort();
    await assert.rejects(workspace.replace("sum + item.priceCents", "0", cancel.signal));
    assert.equal(await workspace.read("total.mjs"), original);
  } finally { await workspace.dispose(); }
});

test("concurrent exact edits serialize, so stale source cannot silently overwrite a preceding edit", async () => {
  const workspace = await createCodingWorkspace();
  try {
    const outcomes = await Promise.allSettled([
      workspace.replace("sum + item.priceCents,", "sum + item.priceCents * item.quantity,"),
      workspace.replace("sum + item.priceCents,", "0,"),
    ]);
    assert.equal(outcomes[0].status, "fulfilled"); assert.equal(outcomes[1].status, "rejected");
    assert.match(await workspace.read("total.mjs"), /item.priceCents \* item.quantity/);
  } finally { await workspace.dispose(); }
});

test("Node test permissions deny outside reads, file writes, and child processes, with only platform environment keys", async () => {
  const workspace = await createCodingWorkspace();
  try {
    const original = await workspace.read("total.mjs");
    const guard = `import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const action of [() => readFileSync(process.execPath), () => writeFileSync('unexpected.txt', 'x'), () => spawnSync(process.execPath, ['-v'])]) {
  try { action(); throw new Error('Unexpected permission'); }
  catch (error) { if (error.code !== 'ERR_ACCESS_DENIED') throw error; }
}
const platformKeys = ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'PATH', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR'];
if (Object.keys(process.env).some(key => !platformKeys.includes(key.toUpperCase()))) throw new Error('Inherited environment');
export function totalCents(items) { return items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0); }
`;
    await workspace.replace(original, guard);
    const result = await workspace.runTests(); assert.equal(result.exitCode, 0, result.output);
    await assert.rejects(access(workspace.directory + "/unexpected.txt"), { code: "ENOENT" });
  } finally { await workspace.dispose(); }
});

test("infinite execution, excessive output, and cancellation stop the test child and release the workspace", async () => {
  for (const mode of ["deadline", "output", "cancel"] as const) {
    const workspace = await createCodingWorkspace();
    try {
      const original = await workspace.read("total.mjs");
      await workspace.replace(original, mode === "output" ? "console.log('x'.repeat(20000));\n" + original :
        "while (true) {}\n" + original);
      const cancel = new AbortController();
      const running = workspace.runTests(cancel.signal, undefined, mode === "deadline" ? 150 : 5000);
      const timer = mode === "cancel" ? setTimeout(() => cancel.abort(), 150) : undefined;
      try { await assert.rejects(running, /deadline|budget|cancelled/); } finally { clearTimeout(timer); }
    } finally { await workspace.dispose(); }
    await assert.rejects(access(workspace.directory), { code: "ENOENT" });
  }
});

test("eight test runs exhaust the budget and disposal cancels a running child before deleting its project", async () => {
  const limited = await createCodingWorkspace();
  try {
    for (let i = 0; i < 8; i++) assert.equal((await limited.runTests()).exitCode, 1);
    await assert.rejects(limited.runTests(), /test-run budget/);
  } finally { await limited.dispose(); }
  const active = await createCodingWorkspace();
  const original = await active.read("total.mjs");
  await active.replace(original, "console.log('started'); while (true) {}\n" + original);
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const run = active.runTests(undefined, () => started());
  const stopped = assert.rejects(run, /cancelled/);
  try {
    await Promise.race([ready, stopped.then(() => { throw new Error("Test process stopped before producing output"); })]);
    await active.dispose(); await stopped;
  }
  finally { await active.dispose(); }
  await assert.rejects(access(active.directory), { code: "ENOENT" });
});

test("actual Pi repairs files through tools, displays failing and passing results once, then rechecks the same project in a new Context", async () => {
  const { runtime, model } = await createCodingModel();
  const source = await createCodingSource(runtime, model);
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode(value: boolean) { this.isRaw = value; } });
  const operations: AppliedBlockOperation[] = [];
  const endpoint = new TerminalProtocolEndpoint({ completeBaselineSupported: true,
    operationAdapter: { prepare() {}, accept(op) { operations.push(op); } } });
  const decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  let ordinary = "";
  let finalSource = "";
  const output = Object.assign(new Writable({ write(chunk: Buffer, _encoding, done) {
    try {
      let text = "";
      for (const event of decoder.push(chunk)) if (event.type === "ordinary") text += Buffer.from(event.data).toString("utf8");
      ordinary += text;
      const result = endpoint.push(chunk); assert.deepEqual(result.diagnostics, []);
      queueMicrotask(() => {
        for (const frame of result.responseFrames) input.write(frame);
        if (text.includes("[ready 1/")) input.write(JSON.stringify({ type: "prompt", text: CODING_PROMPT }) + "\n");
        if (text.includes("[ready 2/")) input.write(JSON.stringify({ type: "prompt", text: FOLLOWUP_PROMPT }) + "\n");
      });
      done();
    } catch (error) { done(error as Error); }
  } }), { isTTY: true });
  try {
    assert.equal(await runMultiRound({ input, output, maxRounds: 2, deadlineMs: 15000, adapterLimits: CODING_LIMITS,
      createSource: async () => ({ ...source, async dispose() {
        finalSource = await source.workspace.read("total.mjs"); await source.dispose();
      } }) }), "limit");
    assert.match(finalSource, /item.priceCents \* item.quantity/);
    const contexts = endpoint.contexts(); assert.equal(contexts.length, 2);
    assert(contexts.every(context => context.state === "closed" && context.blocks.every(block => block.lifecycle === "sealed")));
    const toolBlocks = contexts.flatMap(context => context.blocks).filter(block => block.content.data.startsWith("Tool: run_coding_tests\n"));
    assert.equal(toolBlocks.length, 3);
    assert.match(toolBlocks[0].content.data, /Exit code: 1\n[\s\S]*3 passed, 3 failed/);
    assert(toolBlocks.slice(1).every(block => block.content.data.includes("Exit code: 0\n") && block.content.data.includes("6 passed, 0 failed")));
    assert(operations.some(op => op.kind === "block.extend"));
    assert(operations.some(op => op.kind === "block.replace_suffix"));
    assert.match(ordinary, /round 2 completed/);
    assert.equal(input.isRaw, false); assert.equal(input.listenerCount("data"), 0);
    await assert.rejects(access(source.workspace.directory), { code: "ENOENT" });
  } finally { await source.dispose(); }
});
