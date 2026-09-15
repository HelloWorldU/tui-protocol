import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { Commands } from "./commands.mjs";
import { runRound } from "./rounds.mjs";
import { prepareExample } from "./prepare.ts";

test("next commands during generation are dropped and quit resolves a pending wait without starting a round", async () => {
  const commands = new Commands();
  commands.feed(Buffer.from("n")); // No waiting round yet.
  let resolved = false;
  const next = commands.next().then(value => { resolved = true; return value; });
  await Promise.resolve(); assert.equal(resolved, false);
  commands.feed(Buffer.from("nnnn")); assert.equal(await next, true);
  commands.feed(Buffer.from("n")); // Busy, do not save it for the next wait.
  const later = commands.next();
  commands.feed(Buffer.from("q")); assert.equal(await later, false);
  assert.equal(commands.signal.aborted, true);
  assert.equal(await commands.next(), false);
});

test("one round revises thinking after later Blocks exist and uses the returned answer base for incremental edits", async () => {
  const calls = [];
  const context = Object.fromEntries(["append", "extend", "update", "seal", "replaceSuffix"].map(name =>
    [name, (...args) => { calls.push([name, ...args]); return String(calls.length); }]));
  await runRound(context, 1, async () => {});
  assert.deepEqual(calls.map(call => call[0]), ["append", "append", "extend", "append", "append", "update", "seal", "replaceSuffix", "extend", "seal"]);
  assert.equal(calls[2][2], "2");
  assert.deepEqual(calls[7], ["replaceSuffix", "answer-1", "5", 10, "result"]);
  assert.deepEqual(calls[8], ["extend", "answer-1", "8", "\nThe simulated change is ready."]);
});

test("cancelling at a round pause does not send later content Operations", async () => {
  const calls = [];
  await assert.rejects(runRound({ append: (...args) => calls.push(args) }, 1,
    async () => { throw new Error("cancelled"); }), /cancelled/);
  assert.equal(calls.length, 2);
});

test("the prepared multi-round application runs outside the repository and emits finite plain fallback without OSC", t => {
  const prepared = dirname(prepareExample());
  const isolated = mkdtempSync(join(tmpdir(), "tui-multi-round-"));
  t.after(() => rmSync(prepared, { recursive: true, force: true }));
  t.after(() => rmSync(isolated, { recursive: true, force: true }));
  cpSync(prepared, isolated, { recursive: true });
  const output = execFileSync(process.execPath, ["--no-experimental-strip-types", join(isolated, "application.mjs")], {
    cwd: isolated, encoding: "utf8", windowsHide: true, timeout: 10_000,
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
  });
  assert.equal(output, "[fallback] Multi-round simulation (non-interactive)\r\nRound 1: simulated inspection complete\r\nAnswer 1: result\r\nRound 2: simulated inspection complete\r\nAnswer 2: result\r\nRound 3: simulated inspection complete\r\nAnswer 3: result\r\n");
  assert.ok(!output.includes("\x1b"));
});
