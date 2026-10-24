import "./styled-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import headless from "@xterm/headless";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { StyledTextSpan } from "@tui-protocol/sdk";
import { contentText } from "@tui-protocol/terminal";
import { prepareStockUiTrial, type PreparedTrial } from "./application.ts";
import { PiEventAdapter, DEFAULT_TRIAL_LIMITS, type ContentPart, type TrialEvent } from "./event-adapter.ts";
import { FakeHost } from "./fake-host.ts";
import { createFixtureModel } from "./fixtures/provider.ts";
import type { TrialFixtureText } from "./fixtures/provider.ts";
import { createAssistantSpanRenderer } from "./styled-renderer.ts";
import { createTrialRuntime, TRIAL_PROMPT, type TrialRuntimeSource } from "./session-source.ts";

const { Terminal } = headless;

interface RecordedOp {
  readonly kind: "append" | "update" | "extend" | "replaceSuffix" | "seal";
  readonly blockId: string;
  readonly content?: string | readonly StyledTextSpan[];
  readonly fragment?: string | readonly StyledTextSpan[];
  readonly retain?: number;
  readonly replacement?: string | readonly StyledTextSpan[];
  readonly lifecycle?: "mutable" | "sealed";
}

/** Records adapter Operations; returned IDs stand in for sent state. */
class RecordingWriter {
  readonly ops: RecordedOp[] = [];
  append(blockId: string, content: string | readonly StyledTextSpan[], lifecycle: "mutable" | "sealed"): string {
    this.ops.push({ kind: "append", blockId, content, lifecycle });
    return String(this.ops.length);
  }
  update(blockId: string, content: string | readonly StyledTextSpan[]): string {
    this.ops.push({ kind: "update", blockId, content });
    return String(this.ops.length);
  }
  extend(blockId: string, _base: string, fragment: string | readonly StyledTextSpan[]): string {
    this.ops.push({ kind: "extend", blockId, fragment });
    return String(this.ops.length);
  }
  replaceSuffix(blockId: string, _base: string, retain: number, replacement: string | readonly StyledTextSpan[]): string {
    this.ops.push({ kind: "replaceSuffix", blockId, retain, replacement });
    return String(this.ops.length);
  }
  seal(blockId: string): string {
    this.ops.push({ kind: "seal", blockId });
    return String(this.ops.length);
  }
}

function runAdapter(events: readonly TrialEvent[]): { writer: RecordingWriter; adapter: PiEventAdapter } {
  const writer = new RecordingWriter();
  const adapter = new PiEventAdapter(writer, DEFAULT_TRIAL_LIMITS, createAssistantSpanRenderer({ width: () => 80 }));
  for (const event of events) adapter.accept(event);
  return { writer, adapter };
}

const user = (text: string) => ({ role: "user", content: text });
const assistantText = (text: string, stopReason?: string) => ({
  role: "assistant", content: [{ type: "text", text }], stopReason,
});

function turnPrefix(): TrialEvent[] {
  return [
    { type: "agent_start" },
    { type: "message_start", message: user("hi") },
    { type: "message_end", message: user("hi") },
    { type: "turn_start" },
  ];
}
const turnSuffix: readonly TrialEvent[] = [{ type: "turn_end" }, { type: "agent_end", willRetry: false }];

/** Concatenates the Append and Extend payloads of a pure-growth Block. */
function collectSpans(writer: RecordingWriter, blockId: string): StyledTextSpan[] {
  const spans: StyledTextSpan[] = [];
  for (const op of writer.ops) {
    if (op.blockId !== blockId) continue;
    assert.notEqual(op.kind, "replaceSuffix", "collectSpans only applies to extend-only flows");
    if (op.kind === "append") spans.push(...op.content as StyledTextSpan[]);
    if (op.kind === "extend") spans.push(...op.fragment as StyledTextSpan[]);
  }
  return spans;
}

function spansText(spans: readonly StyledTextSpan[]): string {
  return spans.map(span => span.text).join("");
}

test("styled streaming extends the assistant Block with Pi-rendered spans whose logical text matches the plain transcript", () => {
  const { writer, adapter } = runAdapter([
    ...turnPrefix(),
    { type: "message_start", message: assistantText("") },
    { type: "message_update", message: assistantText("Reading") },
    { type: "message_update", message: assistantText("Reading the local sample.") },
    { type: "message_end", message: assistantText("Reading the local sample.", "stop") },
    ...turnSuffix,
  ]);
  assert.equal(adapter.state, "finished");
  const assistantOps = writer.ops.filter(op => op.blockId === "pi-2");
  assert.deepEqual(assistantOps.map(op => op.kind), ["append", "extend", "extend", "seal"]);
  const spans = collectSpans(writer, "pi-2");
  assert.deepEqual(spans[0], { text: "Assistant:\n" });
  assert(spans.slice(1).every(span => span.style === undefined), "plain prose renders without styling");
  assert.equal(spansText(spans), "Assistant:\nReading the local sample.");
});

test("thinking content keeps Pi's thinking style, italic in the thinkingText color, inside the styled Block", () => {
  const { writer, adapter } = runAdapter([
    ...turnPrefix(),
    { type: "message_start", message: assistantText("") },
    { type: "message_end", message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me think about this." },
        { type: "text", text: "The answer is 42." },
      ],
      stopReason: "stop",
    } },
    ...turnSuffix,
  ]);
  assert.equal(adapter.state, "finished");
  const spans = collectSpans(writer, "pi-2");
  assert(spans.some(span =>
    span.text === "Let me think about this." &&
    span.style?.italic === true &&
    typeof span.style?.foreground === "object"), `thinking span missing its style: ${JSON.stringify(spans)}`);
  // The logical text is the rendered projection: the thinking body itself, no
  // plain-mode "[Thinking]" label.
  assert.equal(spansText(spans), "Assistant:\nLet me think about this.\n\nThe answer is 42.");
});

test("an error end carries Pi's error label in the error color instead of the plain-mode suffix", () => {
  const { writer, adapter } = runAdapter([
    ...turnPrefix(),
    { type: "message_start", message: assistantText("") },
    { type: "message_update", message: assistantText("partial") },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "boom" } },
    ...turnSuffix,
  ]);
  assert.equal(adapter.state, "finished");
  const spans = collectSpans(writer, "pi-2");
  const errorSpan = spans.find(span => span.text === "Error: boom");
  assert(errorSpan, `error label missing: ${JSON.stringify(spans)}`);
  assert.equal(typeof errorSpan.style?.foreground, "object", "the error label carries the theme error color");
  assert(!spansText(spans).includes("[error]"), "the plain-mode suffix leaked into the styled Block");
  assert.equal(spansText(spans), "Assistant:\npartial\n\nError: boom");
});

test("markdown emphasis in the assistant text becomes bold, code-colored, and italic spans", () => {
  const { writer, adapter } = runAdapter([
    ...turnPrefix(),
    { type: "message_start", message: assistantText("") },
    { type: "message_end", message: assistantText("Some **bold** and `code` and *italic* text.", "stop") },
    ...turnSuffix,
  ]);
  assert.equal(adapter.state, "finished");
  const spans = collectSpans(writer, "pi-2");
  assert(spans.some(span => span.text === "bold" && span.style?.bold === true), JSON.stringify(spans));
  assert(spans.some(span => span.text === "code" && typeof span.style?.foreground === "object"), JSON.stringify(spans));
  assert(spans.some(span => span.text === "italic" && span.style?.italic === true), JSON.stringify(spans));
  assert.equal(spansText(spans), "Assistant:\nSome bold and code and italic text.");
});

test("a re-render that restyles earlier text degrades to ReplaceSuffix at the span-exact common prefix", () => {
  const { writer, adapter } = runAdapter([
    ...turnPrefix(),
    { type: "message_start", message: assistantText("") },
    { type: "message_update", message: assistantText("**bo") },
    { type: "message_update", message: assistantText("**bold**") },
    { type: "message_end", message: assistantText("**bold**", "stop") },
    ...turnSuffix,
  ]);
  assert.equal(adapter.state, "finished");
  const assistantOps = writer.ops.filter(op => op.blockId === "pi-2");
  assert.deepEqual(assistantOps.map(op => op.kind), ["append", "extend", "replaceSuffix", "seal"]);
  const replacement = assistantOps[2]!;
  // "**bo" rendered literally; "**bold**" re-rendered as a bold span, so only
  // the 11-scalar "Assistant:\n" label prefix survives the style drift.
  assert.equal(replacement.retain, "Assistant:\n".length);
  assert.deepEqual(replacement.replacement, [{ text: "bold", style: { bold: true } }]);
});

test("user and tool Blocks stay text/plain when the terminal confirmed text/styled", () => {
  const toolCall = { type: "toolCall", id: "c1", name: "read_trial_sample", arguments: {} } as ContentPart;
  const { writer, adapter } = runAdapter([
    ...turnPrefix(),
    { type: "message_start", message: assistantText("") },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Reading." }, toolCall], stopReason: "toolUse" } },
    { type: "tool_execution_start", toolCallId: "c1", toolName: "read_trial_sample" },
    { type: "tool_execution_end", toolCallId: "c1", result: { content: [{ type: "text", text: "Trial sample." }] }, isError: false },
    { type: "message_start", message: { role: "toolResult", content: [{ type: "text", text: "Trial sample." }], toolCallId: "c1" } },
    { type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "Trial sample." }], toolCallId: "c1" } },
    { type: "message_start", message: assistantText("") },
    { type: "message_end", message: assistantText("Done.", "stop") },
    ...turnSuffix,
  ]);
  assert.equal(adapter.state, "finished");
  const appends = new Map(writer.ops.filter(op => op.kind === "append").map(op => [op.blockId, op.content]));
  assert.equal(typeof appends.get("pi-1"), "string", "user Block stays plain");
  assert(Array.isArray(appends.get("pi-2")), "assistant Block is styled");
  assert.equal(typeof appends.get("pi-3"), "string", "tool Block stays plain");
  assert(Array.isArray(appends.get("pi-4")), "second assistant Block is styled");
});

interface StyledTrial {
  readonly terminal: InstanceType<typeof Terminal>;
  readonly host: FakeHost;
  readonly source: TrialRuntimeSource;
  readonly prepared: PreparedTrial;
  readonly failures: Error[];
}

async function composeStyledTrial(fixtureText?: TrialFixtureText): Promise<StyledTrial> {
  const terminal = new Terminal({ allowProposedApi: true, cols: 80, rows: 24, scrollback: 200 });
  const host = new FakeHost({ supported: true, optionalContentTypes: ["text/styled"], terminal });
  const fixture = await createFixtureModel(10, undefined, 4, fixtureText);
  const source = await createTrialRuntime(fixture, 10, { maxToolCalls: 4 });
  const failures: Error[] = [];
  const prepared = await prepareStockUiTrial({
    input: host.input, output: host.output, source,
    stockTerminal: trial => trial,
    onFailure: error => failures.push(error),
  });
  return { terminal, host, source, prepared, failures };
}

async function teardown(trial: StyledTrial): Promise<void> {
  try { trial.prepared.interactiveMode.stop(); } catch { /* tolerate a stopped UI */ }
  try { trial.prepared.client?.dispose(); } catch { /* already disposed */ }
  await trial.source.dispose();
  trial.terminal.dispose();
}

function bufferRows(terminal: HeadlessTerminal): string[] {
  const rows: string[] = [];
  for (let index = 0; index < terminal.buffer.active.length; index++) {
    rows.push(terminal.buffer.active.getLine(index)?.translateToString(true) ?? "");
  }
  return rows;
}

function findRow(terminal: HeadlessTerminal, text: string): number {
  const row = bufferRows(terminal).indexOf(text);
  assert.notEqual(row, -1, `no buffer row equals ${JSON.stringify(text)}: ${JSON.stringify(bufferRows(terminal))}`);
  return row;
}

function cell(terminal: HeadlessTerminal, row: number, column: number) {
  const value = terminal.buffer.active.getLine(row)?.getCell(column);
  assert.ok(value, `cell ${column},${row}`);
  return value;
}

test("a styled-negotiated fixture turn keeps the plain text projection and content types per Block", async () => {
  const trial = await composeStyledTrial();
  try {
    assert.equal(trial.prepared.mode, "protocol");
    await trial.prepared.interactiveMode.init();
    await trial.source.runtime.session.prompt(TRIAL_PROMPT);
    await trial.prepared.bridge!.drain();
    await trial.host.drain();
    assert.deepEqual(trial.failures, []);
    assert.deepEqual(trial.host.diagnostics, []);
    const contexts = trial.host.contexts();
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].state, "closed");
    const blocks = contexts[0].blocks;
    assert.deepEqual(blocks.map(block => block.id), ["pi-1", "pi-2", "pi-3", "pi-4"]);
    assert(blocks.every(block => block.lifecycle === "sealed"));
    assert.equal(blocks[0].content.type, "text/plain");
    assert.equal(blocks[2].content.type, "text/plain");
    assert.equal(blocks[1].content.type, "text/styled");
    assert.equal(blocks[3].content.type, "text/styled");
    // The styled Blocks' logical text equals the plain-mode transcript.
    assert.equal(blocks[0].content.data, `User:\n${TRIAL_PROMPT}`);
    assert.equal(contentText(blocks[1].content), "Assistant:\nReading the local sample.");
    assert.equal(blocks[2].content.data, "Tool: read_trial_sample\nTrial sample: mutable history keeps old output readable.");
    assert.equal(contentText(blocks[3].content),
      "Assistant:\nResult: mutable history keeps old output readable.\nThe read_trial_sample tool returned the sample.");
    // The buffer shows the same transcript text the plain mode produces.
    for (const line of [
      "User:",
      TRIAL_PROMPT,
      "Assistant:",
      "Reading the local sample.",
      "Tool: read_trial_sample",
      "Trial sample: mutable history keeps old output readable.",
      "Result: mutable history keeps old output readable.",
      "The read_trial_sample tool returned the sample.",
    ]) findRow(trial.terminal, line);
  } finally {
    await teardown(trial);
  }
});

test("Pi's markdown styling reaches the terminal buffer: bold, italic, and code-colored cells", async () => {
  const trial = await composeStyledTrial({
    result: [
      "Result: ", "**mutable history** keeps old output readable.",
      "\nThe `read_trial_sample` tool returned the *sample*.",
    ],
  });
  try {
    await trial.prepared.interactiveMode.init();
    await trial.source.runtime.session.prompt(TRIAL_PROMPT);
    await trial.prepared.bridge!.drain();
    await trial.host.drain();
    assert.deepEqual(trial.failures, []);
    assert.deepEqual(trial.host.diagnostics, []);
    const blocks = trial.host.contexts()[0].blocks;
    const answer = blocks[3].content;
    assert.equal(answer.type, "text/styled");
    // The rendered projection drops the markdown markers, so the logical text
    // is unchanged from the plain fixture's.
    assert.equal(contentText(answer),
      "Assistant:\nResult: mutable history keeps old output readable.\nThe read_trial_sample tool returned the sample.");
    const spans = answer.type === "text/styled" ? answer.data : [];
    assert(spans.some(span => span.text === "mutable history" && span.style?.bold === true), JSON.stringify(spans));
    assert(spans.some(span => span.text === "read_trial_sample" && typeof span.style?.foreground === "object"), JSON.stringify(spans));
    assert(spans.some(span => span.text === "sample" && span.style?.italic === true), JSON.stringify(spans));

    const resultRow = findRow(trial.terminal, "Result: mutable history keeps old output readable.");
    const boldStart = "Result: ".length;
    for (let column = boldStart; column < boldStart + "mutable history".length; column++) {
      assert.equal(Boolean(cell(trial.terminal, resultRow, column).isBold()), true, `bold cell at ${column}`);
    }
    assert.equal(Boolean(cell(trial.terminal, resultRow, 0).isBold()), false, "the unstyled prefix stays plain");

    const sampleRow = findRow(trial.terminal, "The read_trial_sample tool returned the sample.");
    const codeStart = "The ".length;
    for (let column = codeStart; column < codeStart + "read_trial_sample".length; column++) {
      const codeCell = cell(trial.terminal, sampleRow, column);
      assert.equal(codeCell.isFgRGB(), true, `code cell ${column} uses an RGB foreground`);
      assert.equal(codeCell.getFgColor(), 0x8abeb7, "the dark theme's mdCode color");
    }
    const italicStart = "The read_trial_sample tool returned the ".length;
    for (let column = italicStart; column < italicStart + "sample".length; column++) {
      assert.equal(Boolean(cell(trial.terminal, sampleRow, column).isItalic()), true, `italic cell at ${column}`);
    }
  } finally {
    await teardown(trial);
  }
});
