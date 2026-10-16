import assert from "node:assert/strict";
import test from "node:test";
import { TuiClient, spansFromAnsi, type StyledTextSpan } from "../src/index.ts";
import {
  ProtocolStreamDecoder, encodeMessageFrames, type DecoderEvent, type Message,
} from "@tui-protocol/protocol";
import { TerminalProtocolEndpoint } from "@tui-protocol/terminal";

function fixture(optionalContentTypes: readonly string[]) {
  const sent: Message[] = [];
  const decoder = new ProtocolStreamDecoder();
  const client = new TuiClient({ write(bytes) {
    for (const event of decoder.push(bytes)) {
      assert.equal(event.type, "message");
      if (event.type === "message") sent.push(event.message);
    }
  } });
  let frameId = 0;
  const respond = (message: Message) =>
    encodeMessageFrames(message, ++frameId).flatMap(frame => client.receive(frame));
  const open = async () => {
    const support = client.negotiate();
    respond({ version: 1, kind: "capability.response", request_id: "1",
      body: { outcome: "supported", optional_content_types: [...optionalContentTypes] } });
    assert.equal(await support, true);
    const opening = client.openContext();
    respond({ version: 1, kind: "context.open.response", request_id: "2",
      context_id: "context", body: { outcome: "opened" } });
    return opening;
  };
  return { client, sent, respond, open };
}

test("optional content types are empty until a positive response and track renegotiation", async () => {
  const f = fixture(["text/styled"]);
  try {
    assert.deepEqual(f.client.optionalContentTypes, []);
    assert.equal(f.client.supportsStyledContent, false);
    const support = f.client.negotiate();
    assert.equal(f.client.supportsStyledContent, false, "a pending query confirms nothing");
    f.respond({ version: 1, kind: "capability.response", request_id: "1",
      body: { outcome: "supported", optional_content_types: ["text/styled"] } });
    assert.equal(await support, true);
    assert.deepEqual(f.client.optionalContentTypes, ["text/styled"]);
    assert.equal(f.client.supportsStyledContent, true);
    const again = f.client.negotiate();
    assert.equal(f.client.supportsStyledContent, false, "a fresh query clears the prior confirmation");
    f.respond({ version: 1, kind: "capability.response", request_id: "2", body: { outcome: "unsupported" } });
    assert.equal(await again, false);
    assert.deepEqual(f.client.optionalContentTypes, []);
  } finally { f.client.dispose(); }
});

test("span arguments encode text/styled content for all four content Operations", async () => {
  const f = fixture(["text/styled"]);
  try {
    const context = await f.open();
    const spans: StyledTextSpan[] = [
      { text: "Hello, " },
      { text: "world", style: { bold: true, foreground: { palette: 2 } } },
    ];
    const appended = context.append("doc", spans, "mutable");
    const updated = context.update("doc", spans);
    const extended = context.extend("doc", updated, spans);
    const replaced = context.replaceSuffix("doc", extended, 3, spans);
    const operations = f.sent.filter(message => "operation_id" in message);
    assert.deepEqual(operations.map(message => [message.kind, message.operation_id]), [
      ["block.append", appended],
      ["block.update", updated],
      ["block.extend", extended],
      ["block.replace_suffix", replaced],
    ]);
    const snapshot = { type: "text/styled", data: spans };
    assert.deepEqual(operations[0].body, { block_id: "doc", lifecycle: "mutable", content: snapshot });
    assert.deepEqual(operations[1].body, { block_id: "doc", content: snapshot });
    assert.deepEqual(operations[2].body, { block_id: "doc", base_operation_id: updated, fragment: spans });
    assert.deepEqual(operations[3].body,
      { block_id: "doc", base_operation_id: extended, retain: 3, replacement: spans });
  } finally { f.client.dispose(); }
});

test("styled spans without confirmed text/styled throw before any bytes are written", async () => {
  const f = fixture([]);
  try {
    const context = await f.open();
    const spans: StyledTextSpan[] = [{ text: "styled", style: { bold: true } }];
    const sends = [
      () => context.append("b", spans, "sealed"),
      () => context.update("b", spans),
      () => context.extend("b", "1", spans),
      () => context.replaceSuffix("b", "1", 0, spans),
    ];
    for (const send of sends) assert.throws(send, /text\/styled/);
    assert.equal(f.sent.some(message => message.kind.startsWith("block.")), false);
    assert.equal(typeof context.append("b", "plain", "sealed"), "string", "plain strings still send");
  } finally { f.client.dispose(); }
});

test("string arguments keep encoding text/plain even when text/styled is confirmed", async () => {
  const f = fixture(["text/styled"]);
  try {
    const context = await f.open();
    context.append("b", "text", "sealed");
    context.update("b", "more");
    context.extend("b", "1", "tail");
    context.replaceSuffix("b", "2", 1, "suffix");
    const operations = f.sent.filter(message => "operation_id" in message);
    assert.deepEqual(operations[0].body,
      { block_id: "b", lifecycle: "sealed", content: { type: "text/plain", data: "text" } });
    assert.deepEqual(operations[1].body, { block_id: "b", content: { type: "text/plain", data: "more" } });
    assert.deepEqual(operations[2].body, { block_id: "b", base_operation_id: "1", fragment: "tail" });
    assert.deepEqual(operations[3].body,
      { block_id: "b", base_operation_id: "2", retain: 1, replacement: "suffix" });
  } finally { f.client.dispose(); }
});

test("an empty span list is valid content for Append, Update, and ReplaceSuffix but not an Extend fragment", async () => {
  const f = fixture(["text/styled"]);
  try {
    const context = await f.open();
    context.append("b", [], "mutable");
    context.update("b", []);
    context.replaceSuffix("b", "1", 0, []);
    const operations = f.sent.filter(message => "operation_id" in message);
    assert.deepEqual(operations[0].body,
      { block_id: "b", lifecycle: "mutable", content: { type: "text/styled", data: [] } });
    assert.deepEqual(operations[1].body, { block_id: "b", content: { type: "text/styled", data: [] } });
    assert.deepEqual(operations[2].body,
      { block_id: "b", base_operation_id: "1", retain: 0, replacement: [] });
    const count = f.sent.length;
    assert.throws(() => context.extend("b", "2", []), /must not be empty/);
    assert.equal(f.sent.length, count, "local validation emits no partial Message");
  } finally { f.client.dispose(); }
});

test("spans, including ANSI-converted output, flow through a styled-capable terminal endpoint", async () => {
  const terminal = new TerminalProtocolEndpoint({
    completeBaselineSupported: true, optionalContentTypes: ["text/styled"],
  });
  const received: DecoderEvent[] = [];
  const client = new TuiClient({ write(bytes) {
    const result = terminal.push(bytes);
    assert.deepEqual(result.diagnostics, []);
    queueMicrotask(() => {
      for (const frame of result.responseFrames) for (const byte of frame) {
        received.push(...client.receive(Uint8Array.of(byte)));
      }
    });
  } });
  try {
    assert.equal(await client.negotiate(), true);
    assert.equal(client.supportsStyledContent, true);
    const context = await client.openContext();
    const base = context.append("status", spansFromAnsi("\x1b[1;32mBuilding"), "mutable");
    const edited = context.replaceSuffix("status", base, 4, spansFromAnsi("\x1b[0m\x1b[31mFailed"));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(terminal.context(context.id)?.blocks[0]?.content, {
      type: "text/styled",
      data: [
        { text: "Buil", style: { bold: true, foreground: { palette: 2 } } },
        { text: "Failed", style: { foreground: { palette: 1 } } },
      ],
    });
    assert.equal(received.some(event => event.type === "message" &&
      event.message.kind === "protocol.error" && event.message.operation_id === edited), false,
      "neither styled Operation reports an asynchronous error");
    await context.close();
  } finally { client.dispose(); }
});
