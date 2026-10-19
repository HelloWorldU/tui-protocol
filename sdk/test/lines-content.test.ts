import assert from "node:assert/strict";
import test from "node:test";
import { TuiClient, type LinesTextLine } from "../src/index.ts";
import { ProtocolStreamDecoder, encodeMessageFrames, type DecoderEvent, type Message } from "@tui-protocol/protocol";
import { TerminalProtocolEndpoint, contentText } from "@tui-protocol/terminal";

// Experimental text/lines content (RFC 0003) through the SDK client.

const bullet: LinesTextLine = { spans: [{ text: "- streaming item" }], continuation: [{ text: "  " }] };

function fixture(optionalContentTypes: readonly string[]) {
  const sent: Message[] = [];
  const decoder = new ProtocolStreamDecoder();
  const client = new TuiClient({ write(bytes) {
    for (const event of decoder.push(bytes)) if (event.type === "message") sent.push(event.message);
  } });
  let frameId = 0;
  const respond = (message: Message) => encodeMessageFrames(message, ++frameId).flatMap(frame => client.receive(frame));
  const open = async () => {
    const support = client.negotiate();
    respond({ version: 1, kind: "capability.response", request_id: "1",
      body: { outcome: "supported", optional_content_types: [...optionalContentTypes] } });
    assert.equal(await support, true);
    const opening = client.openContext();
    respond({ version: 1, kind: "context.open.response", request_id: "2", context_id: "context", body: { outcome: "opened" } });
    return opening;
  };
  return { client, sent, open };
}

test("line arguments encode text/lines content and line fragments for all four content Operations", async () => {
  const f = fixture(["text/styled", "text/lines"]);
  try {
    const context = await f.open();
    assert.equal(f.client.supportsLinesContent, true);
    context.append("b", [bullet], "mutable");
    context.update("b", [bullet, { spans: [{ text: "─" }], fill: true }]);
    context.extend("b", "2", [{ spans: [] }, { spans: [{ text: "next" }] }]);
    context.replaceSuffix("b", "3", 2, [{ spans: [{ text: "x" }] }]);
    const bodies = f.sent.filter(message => message.kind.startsWith("block.")).map(message => message.body);
    assert.deepEqual(bodies, [
      { block_id: "b", lifecycle: "mutable", content: { type: "text/lines", data: [bullet] } },
      { block_id: "b", content: { type: "text/lines", data: [bullet, { spans: [{ text: "─" }], fill: true }] } },
      { block_id: "b", base_operation_id: "2", fragment: [{ spans: [] }, { spans: [{ text: "next" }] }] },
      { block_id: "b", base_operation_id: "3", retain: 2, replacement: [{ spans: [{ text: "x" }] }] },
    ]);
  } finally { f.client.dispose(); }
});

test("line arguments throw before writing anything when text/lines was not confirmed, while spans still work", async () => {
  const f = fixture(["text/styled"]);
  try {
    const context = await f.open();
    const before = f.sent.length;
    assert.throws(() => context.append("b", [bullet], "mutable"), /text\/lines/);
    assert.throws(() => context.extend("b", "1", [bullet]), /text\/lines/);
    assert.equal(f.sent.length, before, "nothing was written");
    context.append("s", [{ text: "styled" }], "mutable");
    assert.equal(f.sent.at(-1)?.kind, "block.append");
  } finally { f.client.dispose(); }
});

test("a client and a terminal endpoint configured for text/lines stream lines content without errors", async () => {
  const terminal = new TerminalProtocolEndpoint({ completeBaselineSupported: true, optionalContentTypes: ["text/styled", "text/lines"] });
  const received: DecoderEvent[] = [];
  const client = new TuiClient({ write(bytes) {
    const result = terminal.push(bytes);
    assert.deepEqual(result.diagnostics, []);
    queueMicrotask(() => { for (const frame of result.responseFrames) received.push(...client.receive(frame)); });
  } });
  try {
    assert.equal(await client.negotiate(), true);
    const context = await client.openContext();
    const base = context.append("answer", [{ spans: [{ text: "- one" }], continuation: [{ text: "  " }] }], "mutable");
    const next = context.extend("answer", base, [{ spans: [{ text: " two" }] }, { spans: [{ text: "│ quote" }], continuation: [{ text: "│ " }] }]);
    context.replaceSuffix("answer", next, 12, [{ spans: [{ text: "note" }] }]);
    context.seal("answer");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(received.filter(event => event.type !== "message" || event.message.kind === "protocol.error"), [], "no protocol errors");
    const content = terminal.context(context.id)?.blocks[0]?.content;
    assert.ok(content !== undefined);
    assert.equal(contentText(content), "- one two\n│ note");
    assert.deepEqual(content.type === "text/lines" ? content.data[1]?.continuation : undefined, [{ text: "│ " }]);
  } finally { client.dispose(); }
});
