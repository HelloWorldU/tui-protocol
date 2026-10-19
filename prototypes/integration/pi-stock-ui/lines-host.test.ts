import "./styled-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import headless from "@xterm/headless";
import { TuiClient, type LinesTextLine } from "@tui-protocol/sdk";
import { TerminalProtocolEndpoint } from "@tui-protocol/terminal";
import { XtermLinesHost } from "../xterm-lines-host/lines-host.ts";
import { linesFromRender } from "./lines-from-render.ts";
import { logicalLines, renderAt } from "./wrap-experiment.ts";
import { WRAP_SAMPLE } from "./wrap-sample.ts";

const { Terminal } = headless;

// RFC 0003 end to end: Pi's wide render as text/lines, sent by the SDK client
// through the terminal module's endpoint to the experimental xterm lines host.

async function connect(cols: number) {
  const terminal = new Terminal({ allowProposedApi: true, cols, rows: 24, scrollback: 1000 });
  const host = new XtermLinesHost(terminal);
  const endpoint = new TerminalProtocolEndpoint({
    completeBaselineSupported: true, optionalContentTypes: ["text/styled", "text/lines"], operationAdapter: host,
  });
  host.attach(endpoint);
  const client = new TuiClient({ write(bytes) {
    const result = endpoint.push(bytes);
    assert.deepEqual(result.diagnostics, []);
    queueMicrotask(() => { for (const frame of result.responseFrames) client.receive(frame); });
  } });
  assert.equal(await client.negotiate(), true);
  assert.equal(client.supportsLinesContent, true);
  const context = await client.openContext();
  return { terminal, host, client, context };
}

function rows(terminal: InstanceType<typeof Terminal>): string[] {
  const buffer = terminal.buffer.active;
  const result: string[] = [];
  for (let index = 0; index < buffer.length; index++) result.push(buffer.getLine(index)?.translateToString(true) ?? "");
  while (result.at(-1) === "") result.pop();
  return result;
}

const lines = linesFromRender(renderAt(WRAP_SAMPLE, 1000));

test("Pi's text/lines content renders in the xterm buffer exactly as Pi lays it out at 60, then 36, columns", async () => {
  const { terminal, host, client, context } = await connect(60);
  try {
    context.append("answer", lines, "sealed");
    await host.drain();
    assert.deepEqual(rows(terminal), logicalLines(renderAt(WRAP_SAMPLE, 60)));
    terminal.resize(36, 24);
    await host.drain();
    assert.deepEqual(rows(terminal), logicalLines(renderAt(WRAP_SAMPLE, 36)));
    terminal.resize(100, 24);
    await host.drain();
    const pi100 = logicalLines(renderAt(WRAP_SAMPLE, 100));
    const ours = rows(terminal);
    assert.deepEqual(ours.filter((row, index) => row !== pi100[index]).map(row => row.length), [100], "only the full-width rule differs");
  } finally { client.dispose(); terminal.dispose(); }
});

test("the rendered cells carry Pi's styles: the bold phrase and the quote marker's color", async () => {
  const { terminal, host, client, context } = await connect(36);
  try {
    context.append("answer", lines, "sealed");
    await host.drain();
    const buffer = terminal.buffer.active;
    const all = rows(terminal);
    const boldRow = all.findIndex(row => row.startsWith("phrase that keeps going"));
    assert.equal(Boolean(buffer.getLine(boldRow)?.getCell(0)?.isBold()), true, "bold continues on the wrapped row");
    const quoteRow = all.findIndex(row => row.startsWith("│ enough to wrap"));
    const marker = buffer.getLine(quoteRow)!.getCell(0)!;
    assert.equal(marker.isFgRGB(), true);
    assert.equal(marker.getFgColor(), 0x808080, "the continuation marker keeps the first marker's color");
  } finally { client.dispose(); terminal.dispose(); }
});

test("streaming the answer line by line through Extend ends in the same layout as one Append", async () => {
  const { terminal, host, client, context } = await connect(36);
  try {
    let base = context.append("answer", [lines[0]!], "mutable");
    for (const line of lines.slice(1)) {
      // A new line starts with an empty continuation of the current last line.
      base = context.extend("answer", base, [{ spans: [] }, line] as LinesTextLine[]);
    }
    context.seal("answer");
    await host.drain();
    assert.deepEqual(rows(terminal), logicalLines(renderAt(WRAP_SAMPLE, 36)));
  } finally { client.dispose(); terminal.dispose(); }
});

test("copy and search in the rendered rows use the logical text: no continuation prefixes and no soft breaks", async () => {
  const { terminal, host, client, context } = await connect(36);
  try {
    context.append("answer", lines, "sealed");
    await host.drain();
    const all = rows(terminal);
    const quote = all.findIndex(row => row.startsWith("│ A quoted"));
    assert.equal(
      host.copy({ row: quote, col: 0 }, { row: quote + 2, col: 36 }),
      "│ A quoted paragraph that is long enough to wrap, so every quoted row needs its prefix.",
    );
    // At 36 columns the match crosses a soft break: "…continuation" / "  line at sixty…".
    const match = host.find("continuation line at sixty");
    assert.ok(match !== undefined);
    assert.equal(all[match.row], "  enough to wrap onto a continuation");
    assert.equal(all[match.row]!.slice(match.col), "continuation", "the match starts at its first cell");
    assert.equal(all[match.row + 1], "  line at sixty columns.", "and continues after the next row's prefix");
    assert.equal(host.find("│ enough"), undefined, "a continuation marker is not searchable");
  } finally { client.dispose(); terminal.dispose(); }
});
