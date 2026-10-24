import assert from "node:assert/strict";
import test from "node:test";

import type { LinesTextLine, Message } from "@tui-protocol/protocol";
import { layoutLines, rowText } from "../../line-layout/layout.ts";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import { bufferRows, createTerminal, decodeResponses, encodeInput } from "./test-support.ts";

// RFC 0003 text/lines in the private-core history host (no application region).

const answer: LinesTextLine[] = [
  { spans: [{ text: "A paragraph with " }, { text: "bold words", style: { bold: true } }, { text: " that wraps at narrow widths." }] },
  { spans: [{ text: "- a bullet item long enough to need a continuation row" }], continuation: [{ text: "  " }] },
  { spans: [{ text: "│ ", style: { faint: true } }, { text: "a quoted line that also wraps around" }], continuation: [{ text: "│ ", style: { faint: true } }] },
  { spans: [{ text: "─" }], fill: true },
];

function setup(cols: number, rows = 6) {
  const terminal = createTerminal({ cols, rows, scrollback: 200 });
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true,
    optionalContentTypes: ["text/styled", "text/lines"],
  });
  let frame = 0;
  const send = (message: Message) => decodeResponses(endpoint.push(encodeInput(message, ++frame)));
  const [capability] = send({ version: 1, kind: "capability.query", request_id: "c", body: {} });
  assert.deepEqual(capability?.kind === "capability.response" ? capability.body : undefined,
    { outcome: "supported", optional_content_types: ["text/styled", "text/lines"] });
  send({ version: 1, kind: "context.open", request_id: "o", body: {} });
  let operation = 0;
  const op = (kind: string, body: Record<string, unknown>) => {
    const responses = send({ version: 1, kind, operation_id: String(++operation), context_id: "context-1", body } as Message);
    assert.deepEqual(responses, [], `${kind} accepted`);
    return String(operation);
  };
  return { terminal, endpoint, op };
}

const expected = (lines: readonly LinesTextLine[], cols: number) => layoutLines(lines, cols).map(rowText);
const contentRows = (terminal: ReturnType<typeof createTerminal>) => {
  const rows = bufferRows(terminal);
  while (rows.at(-1) === "") rows.pop();
  return rows;
};

test("a text/lines Append materializes the host layout: word wrap, continuation prefixes, and a full-width fill row", async () => {
  const { terminal, endpoint, op } = setup(30);
  try {
    op("block.append", { block_id: "a", lifecycle: "sealed", content: { type: "text/lines", data: answer } });
    await endpoint.drain();
    assert.deepEqual(contentRows(terminal), expected(answer, 30));
    assert.ok(contentRows(terminal).includes("  need a continuation row"), "the bullet continues under its text");
    assert.equal(terminal.buffer.active.getLine(2)?.isWrapped, false, "host rows are hard rows, not xterm soft wraps");
  } finally { endpoint.dispose(); terminal.dispose(); }
});

test("after a resize the history relays out text/lines Blocks at the new width instead of cell reflow", async () => {
  const { terminal, endpoint, op } = setup(30);
  try {
    op("block.append", { block_id: "p", lifecycle: "sealed", content: { type: "text/plain", data: "plain text stays cell-reflowed" } });
    op("block.append", { block_id: "a", lifecycle: "sealed", content: { type: "text/lines", data: answer } });
    await endpoint.drain();
    for (const cols of [20, 44, 30]) {
      terminal.resize(cols, 6);
      await endpoint.drain();
      const rows = contentRows(terminal);
      const start = endpoint.range("context-1", "a")!.start;
      assert.deepEqual(rows.slice(start), expected(answer, cols), `${cols} columns`);
    }
  } finally { endpoint.dispose(); terminal.dispose(); }
});

test("styles stay on their characters after relayout, including the repeated quote marker", async () => {
  const { terminal, endpoint, op } = setup(30);
  try {
    op("block.append", { block_id: "a", lifecycle: "sealed", content: { type: "text/lines", data: answer } });
    await endpoint.drain();
    terminal.resize(20, 6);
    await endpoint.drain();
    const rows = contentRows(terminal);
    const marker = rows.findIndex((row, index) => index > 0 && row.startsWith("│ ") && !row.includes("a quoted"));
    assert.ok(marker > 0, `a continuation row of the quote: ${JSON.stringify(rows)}`);
    assert.equal(Boolean(terminal.buffer.active.getLine(marker)?.getCell(0)?.isDim()), true, "the repeated marker is faint");
    const bold = rows.findIndex(row => row.includes("bold"));
    assert.equal(Boolean(terminal.buffer.active.getLine(bold)?.getCell(rows[bold]!.indexOf("bold"))?.isBold()), true);
  } finally { endpoint.dispose(); terminal.dispose(); }
});

test("Extend and ReplaceSuffix on a text/lines Block re-lay out the edited content", async () => {
  const { terminal, endpoint, op } = setup(24);
  try {
    let base = op("block.append", { block_id: "a", lifecycle: "mutable", content: { type: "text/lines", data: [answer[1]!] } });
    base = op("block.extend", { block_id: "a", base_operation_id: base, fragment: [{ spans: [{ text: " more" }] }, answer[2]!] });
    await endpoint.drain();
    const extended: LinesTextLine[] = [{ ...answer[1]!, spans: [...answer[1]!.spans, { text: " more" }] }, answer[2]!];
    assert.deepEqual(contentRows(terminal), expected(extended, 24));
    // Keep "- a bullet" and replace the rest of the first line; the quote line goes.
    op("block.replace_suffix", { block_id: "a", base_operation_id: base, retain: 10, replacement: [{ spans: [{ text: " replaced" }] }] });
    await endpoint.drain();
    assert.deepEqual(contentRows(terminal), expected([{ ...answer[1]!, spans: [{ text: "- a bullet replaced" }] }], 24));
  } finally { endpoint.dispose(); terminal.dispose(); }
});

test("a reader inside a text/lines Block keeps reading it across relayouts", async () => {
  const { terminal, endpoint, op } = setup(30, 3);
  try {
    op("block.append", { block_id: "a", lifecycle: "sealed", content: { type: "text/lines", data: answer } });
    op("block.append", { block_id: "tail", lifecycle: "sealed", content: { type: "text/plain", data: "tail-1\ntail-2\ntail-3\ntail-4" } });
    await endpoint.drain();
    terminal.scrollToLine(endpoint.range("context-1", "a")!.start + 1);
    for (const cols of [20, 40]) {
      terminal.resize(cols, 3);
      await endpoint.drain();
      const range = endpoint.range("context-1", "a")!;
      const top = terminal.buffer.active.viewportY;
      assert.ok(top >= range.start && top < range.start + range.lineCount, `${cols}: the viewport top stays in the Block`);
    }
  } finally { endpoint.dispose(); terminal.dispose(); }
});
