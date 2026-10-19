import assert from "node:assert/strict";
import test from "node:test";
import headless from "@xterm/headless";
import { encodeMessageFrames, type LinesTextLine, type Message } from "@tui-protocol/protocol";
import { TerminalProtocolEndpoint } from "@tui-protocol/terminal";
import { XtermLinesHost } from "./lines-host.ts";

const { Terminal } = headless;

function setup(cols: number, rows: number) {
  const terminal = new Terminal({ allowProposedApi: true, cols, rows, scrollback: 1000 });
  const host = new XtermLinesHost(terminal);
  const endpoint = new TerminalProtocolEndpoint({
    completeBaselineSupported: true, optionalContentTypes: ["text/lines"], operationAdapter: host,
  });
  host.attach(endpoint);
  let frame = 0;
  const send = (message: Message) => endpoint.push(encodeMessageFrames(message, ++frame).reduce(concat));
  send({ version: 1, kind: "capability.query", request_id: "c", body: {} });
  send({ version: 1, kind: "context.open", request_id: "o", body: {} });
  let operation = 0;
  const append = (blockId: string, data: LinesTextLine[]) => send({
    version: 1, kind: "block.append", operation_id: String(++operation), context_id: "context-1",
    body: { block_id: blockId, lifecycle: "sealed", content: { type: "text/lines", data } },
  });
  return { terminal, host, append };
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(left.length + right.length);
  bytes.set(left);
  bytes.set(right, left.length);
  return bytes;
}

const paragraph = (word: string): LinesTextLine[] => [{ spans: [{ text: `${word} `.repeat(30).trim() }] }];

test("a reader above the tail keeps the same logical text at the top of the viewport across resizes", async () => {
  const { terminal, host, append } = setup(40, 5);
  append("a", paragraph("alpha"));
  append("b", paragraph("bravo"));
  append("c", paragraph("charlie"));
  await host.drain();
  const bravo = host.range("context-1", "b")!;
  terminal.scrollToLine(bravo.start + 1);
  const topText = () => terminal.buffer.active.getLine(terminal.buffer.active.viewportY)?.translateToString(true) ?? "";
  assert.match(topText(), /^bravo/);
  for (const cols of [20, 60, 40]) {
    terminal.resize(cols, 5);
    await host.drain();
    const range = host.range("context-1", "b")!;
    const top = terminal.buffer.active.viewportY;
    assert.ok(top >= range.start && top < range.start + range.lineCount, `${cols}: the viewport top stays inside Block b`);
    assert.match(topText(), /^bravo/, `${cols}: the top row still shows Block b's text`);
  }
});

test("a viewport following the tail keeps following it after an Append and a resize", async () => {
  const { terminal, host, append } = setup(40, 5);
  append("a", paragraph("alpha"));
  await host.drain();
  append("b", paragraph("bravo"));
  terminal.resize(30, 5);
  await host.drain();
  const buffer = terminal.buffer.active;
  assert.equal(buffer.viewportY, buffer.baseY);
  // The cursor rests on the empty row after the last content row.
  assert.match(buffer.getLine(buffer.baseY + 3)?.translateToString(true) ?? "", /bravo$/, "the last row of Block b is visible");
});

test("content with a Tab is rejected before mutation, since this host has no Tab projection", async () => {
  const { host, append } = setup(40, 5);
  const result = append("t", [{ spans: [{ text: "a\tb" }] }]);
  assert.equal(result.responseFrames.length, 1, "one protocol.error response");
  await host.drain();
  assert.equal(host.range("context-1", "t"), undefined);
});
