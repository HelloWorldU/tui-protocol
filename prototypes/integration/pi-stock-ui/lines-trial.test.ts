import "./styled-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import headless from "@xterm/headless";
import type { LinesTextLine } from "@tui-protocol/sdk";
import { contentText } from "@tui-protocol/terminal";
import { layoutLines, rowText } from "../../line-layout/layout.ts";
import { prepareStockUiTrial } from "./application.ts";
import { XtermProtocolEndpoint } from "../xterm-protocol-endpoint/index.ts";
import { FakeHost } from "./fake-host.ts";
import { createFixtureModel, type TrialFixtureText } from "./fixtures/provider.ts";
import { createTrialRuntime, TRIAL_PROMPT } from "./session-source.ts";

const { Terminal } = headless;

// The trial's lines path: a terminal confirming text/lines receives Pi's
// assistant render as lines, and lays them out at every width.

const MARKDOWN: TrialFixtureText = {
  result: [
    "## Summary\n\nThe sample reports that **mutable history",
    " keeps old output readable** even when the terminal is resized to a narrow width.\n\n- First point about a protocol-owned transcript",
    " history that wraps across rows\n- Second point\n\n> A quoted remark that also wraps when the terminal is narrow.\n\n",
    "`read_trial_sample` returned the sample.",
  ],
};

async function runTurn(types: readonly ("text/styled" | "text/lines")[]) {
  const terminal = new Terminal({ allowProposedApi: true, cols: 60, rows: 24, scrollback: 400 });
  const host = new FakeHost({ supported: true, optionalContentTypes: types, terminal });
  const source = await createTrialRuntime(await createFixtureModel(10, undefined, 4, MARKDOWN), 10, { maxToolCalls: 4 });
  const failures: Error[] = [];
  const prepared = await prepareStockUiTrial({
    input: host.input, output: host.output, source,
    stockTerminal: trial => trial,
    onFailure: error => failures.push(error),
  });
  await prepared.interactiveMode.init();
  await source.runtime.session.prompt(TRIAL_PROMPT);
  await prepared.bridge!.drain();
  await host.drain();
  return {
    terminal, host, failures,
    async dispose() {
      try { prepared.interactiveMode.stop(); } catch { /* already stopped */ }
      try { prepared.client?.dispose(); } catch { /* already disposed */ }
      await source.dispose();
      terminal.dispose();
    },
  };
}

function answerRows(trial: Awaited<ReturnType<typeof runTurn>>, blockId: string): string[] {
  const endpoint = trial.host.endpoint;
  assert.ok(endpoint instanceof XtermProtocolEndpoint, "an xterm-backed fake host");
  const range = endpoint.range("context-1", blockId);
  assert.ok(range !== undefined, `${blockId} is rendered`);
  return Array.from({ length: range.lineCount }, (_, index) =>
    trial.terminal.buffer.active.getLine(range.start + index)?.translateToString(true) ?? "");
}

test("with text/lines confirmed, assistant Blocks are text/lines while user and tool Blocks stay plain", async () => {
  const trial = await runTurn(["text/styled", "text/lines"]);
  try {
    assert.deepEqual(trial.failures, []);
    assert.deepEqual(trial.host.diagnostics, []);
    const blocks = trial.host.contexts()[0]!.blocks;
    assert.deepEqual(blocks.map(block => block.content.type), ["text/plain", "text/lines", "text/plain", "text/lines"]);
    const answer = blocks[3]!.content;
    assert.equal(answer.type, "text/lines");
    const lines = answer.type === "text/lines" ? answer.data : [];
    assert.ok(lines.some(line => line.continuation?.[0]?.text === "  "), "a bullet carries its hanging indent");
    assert.ok(lines.some(line => line.continuation?.[0]?.text === "│ "), "the quote carries its marker");
    assert.match(contentText(answer), /The sample reports that mutable history keeps old output readable even when/, "one logical line per paragraph");
    assert.ok(trial.host.messageKinds.includes("block.extend"), "streaming used Extend");
  } finally { await trial.dispose(); }
});

test("the streamed answer renders as the host layout at 60 columns and is laid out again at 36 and 90", async () => {
  const trial = await runTurn(["text/styled", "text/lines"]);
  try {
    const answer = trial.host.contexts()[0]!.blocks[3]!.content;
    const lines = (answer.type === "text/lines" ? answer.data : []) as LinesTextLine[];
    assert.deepEqual(answerRows(trial, "pi-4"), layoutLines(lines, 60).map(rowText));
    for (const cols of [36, 90]) {
      trial.terminal.resize(cols, 24);
      await trial.host.drain();
      const rows = answerRows(trial, "pi-4");
      assert.deepEqual(rows, layoutLines(lines, cols).map(rowText), `${cols} columns`);
    }
    trial.terminal.resize(36, 24);
    await trial.host.drain();
    const narrow = answerRows(trial, "pi-4");
    assert.ok(narrow.some(row => /^ {2}\S/.test(row) && !row.startsWith("- ")), "a bullet continuation row is indented under its text");
    assert.ok(narrow.filter(row => row.startsWith("│ ")).length >= 2, "every quote row carries the marker");
  } finally { await trial.dispose(); }
});

test("with only text/styled confirmed, the trial keeps the styled path unchanged", async () => {
  const trial = await runTurn(["text/styled"]);
  try {
    assert.deepEqual(trial.failures, []);
    const blocks = trial.host.contexts()[0]!.blocks;
    assert.deepEqual(blocks.map(block => block.content.type), ["text/plain", "text/styled", "text/plain", "text/styled"]);
  } finally { await trial.dispose(); }
});
