import assert from "node:assert/strict";
import test from "node:test";
import { TuiClient, ControlTimeoutError, ControlResponseError } from "../src/index.ts";
import { ProtocolStreamDecoder, encodeMessageFrames, type Message, type DecoderEvent } from "../../protocol/src/index.ts";
import { TerminalProtocolEndpoint } from "../../terminal/src/index.ts";

function fixture(timeoutMs = 2000) {
  const sent: Message[] = [];
  const decoder = new ProtocolStreamDecoder();
  const client = new TuiClient({ timeoutMs, write(bytes) {
    for (const event of decoder.push(bytes)) {
      assert.equal(event.type, "message");
      if (event.type === "message") sent.push(event.message);
    }
  } });
  let frameId = 0;
  const respond = (message: Message) => encodeMessageFrames(message, ++frameId).flatMap(frame => client.receive(frame));
  return { client, sent, respond };
}
type Fixture = ReturnType<typeof fixture>;
async function open(f: Fixture) {
  const support = f.client.negotiate();
  f.respond({ version: 1, kind: "capability.response", request_id: "1", body: { outcome: "supported", optional_content_types: [] } });
  assert.equal(await support, true);
  const context = f.client.openContext();
  f.respond({ version: 1, kind: "context.open.response", request_id: "2", context_id: "context", body: { outcome: "opened" } });
  return context;
}

test("the SDK and terminal endpoint exchange split response bytes and execute all five Operations", async () => {
  const terminal = new TerminalProtocolEndpoint({ completeBaselineSupported: true });
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
    const context = await client.openContext();
    const created = context.append("thinking", "中文", "mutable");
    const extended = context.extend("thinking", created, "后缀");
    const replaced = context.replaceSuffix("thinking", extended, 2, "完成");
    assert.equal(terminal.context(context.id)?.blocks[0].content.data, "中文完成");
    assert.notEqual(replaced, extended);
    context.update("thinking", "最终内容");
    context.seal("thinking");
    const rejected = context.update("thinking", "must not render");
    assert.equal(typeof rejected, "string", "sending returns an ID even when the terminal rejects the Operation");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(terminal.context(context.id)?.blocks[0].content.data, "最终内容");
    assert(received.some(event => event.type === "message" && event.message.kind === "protocol.error" &&
      event.message.operation_id === rejected && event.message.body.code === "block_sealed"));
    await context.close();
    assert.equal(terminal.context(context.id)?.state, "closed");
    assert.throws(() => context.seal("thinking"), /closed/);
  } finally { client.dispose(); }
});

test("no positive capability response means no Context request or Block output", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.client.openContext(), /Positive capability/);
    assert.equal(f.sent.length, 0);
    const support = f.client.negotiate();
    f.respond({ version: 1, kind: "capability.response", request_id: "1", body: { outcome: "unsupported" } });
    assert.equal(await support, false);
    await assert.rejects(f.client.openContext(), /Positive capability/);
    assert.deepEqual(f.sent.map(message => message.kind), ["capability.query"]);
  } finally { f.client.dispose(); }
});

test("an unanswered capability query returns false and a late positive response does not enable Contexts", async () => {
  const f = fixture(10);
  try {
    assert.equal(await f.client.negotiate(), false);
    f.respond({ version: 1, kind: "capability.response", request_id: "1", body: { outcome: "supported", optional_content_types: [] } });
    await assert.rejects(f.client.openContext(), /Positive capability/);
    assert.equal(f.sent.length, 1, "no implicit retry");
  } finally { f.client.dispose(); }
});

test("wrong request IDs and response kinds cannot confirm capability support", async () => {
  const f = fixture();
  try {
    let settled = false;
    const support = f.client.negotiate().then(value => { settled = true; return value; });
    await assert.rejects(f.client.negotiate(), /already pending/);
    f.respond({ version: 1, kind: "capability.response", request_id: "other", body: { outcome: "supported", optional_content_types: [] } });
    f.respond({ version: 1, kind: "context.open.response", request_id: "1", context_id: "wrong", body: { outcome: "opened" } });
    await Promise.resolve();
    assert.equal(settled, false);
    f.respond({ version: 1, kind: "capability.response", request_id: "1", body: { outcome: "supported", optional_content_types: [] } });
    assert.equal(await support, true);
  } finally { f.client.dispose(); }
});

test("Context methods supply immutable addressing and preserve the application's explicit incremental base", async () => {
  const f = fixture();
  try {
    const context = await open(f);
    assert(Object.isFrozen(context));
    assert.throws(() => Object.assign(context, { id: "other" }));
    const id = context.append("b", "prefix", "mutable");
    context.extend("b", id, "tail");
    context.replaceSuffix("b", "explicit-stale-base", 2, "");
    const operations = f.sent.filter(message => "operation_id" in message);
    assert.deepEqual(operations.map(message => message.operation_id), ["1", "2", "3"]);
    assert(operations.every(message => message.context_id === context.id));
    assert.deepEqual(operations[2].body, { block_id: "b", base_operation_id: "explicit-stale-base", retain: 2, replacement: "" });
    const count = f.sent.length;
    assert.throws(() => context.extend("b", id, ""));
    assert.equal(f.sent.length, count, "local validation emits no partial Message");
  } finally { f.client.dispose(); }
});

test("closing blocks further Operations and ignores a close response for another Context", async () => {
  const f = fixture();
  try {
    const context = await open(f);
    let settled = false;
    const closing = context.close().then(() => { settled = true; });
    assert.throws(() => context.update("b", "text"), /closing/);
    f.respond({ version: 1, kind: "context.close.response", request_id: "3", context_id: "other", body: { outcome: "closed" } });
    await Promise.resolve();
    assert.equal(settled, false);
    f.respond({ version: 1, kind: "context.close.response", request_id: "3", context_id: context.id, body: { outcome: "closed" } });
    await closing;
    assert.throws(() => context.update("b", "text"), /closed/);
  } finally { f.client.dispose(); }
});

test("a correlated close error reopens the local handle while an unanswered close leaves it unusable", async () => {
  const f = fixture(20);
  try {
    const context = await open(f);
    const closing = context.close();
    f.respond({ version: 1, kind: "context.close.response", request_id: "3", context_id: context.id,
      body: { outcome: "error", error: { code: "internal_error" } } });
    await assert.rejects(closing, ControlResponseError);
    context.append("b", "text", "sealed");
    await assert.rejects(context.close(), ControlTimeoutError);
    assert.throws(() => context.seal("b"), /uncertain/);
    assert.equal(f.sent.filter(message => message.kind === "context.close").length, 2, "only the two explicit calls sent requests");
  } finally { f.client.dispose(); }
});

test("an unanswered Context open rejects without retrying or returning a fabricated handle", async () => {
  const f = fixture(10);
  try {
    const supported = f.client.negotiate();
    f.respond({ version: 1, kind: "capability.response", request_id: "1", body: { outcome: "supported", optional_content_types: [] } });
    await supported;
    await assert.rejects(f.client.openContext(), ControlTimeoutError);
    assert.equal(f.sent.length, 2);
  } finally { f.client.dispose(); }
});

test("ordinary input and malformed protocol data are returned to the application without enabling support", async () => {
  const f = fixture();
  try {
    const events = f.client.receive(new TextEncoder().encode("n\x1b]9002;invalid\x1b\\"));
    assert(events.some(event => event.type === "ordinary" && new TextDecoder().decode(event.data) === "n"));
    assert(events.some(event => event.type === "error"));
    await assert.rejects(f.client.openContext(), /Positive capability/);
  } finally { f.client.dispose(); }
});

test("stream disposal rejects pending controls and prevents old handles from writing", async () => {
  const f = fixture();
  const context = await open(f);
  const pending = f.client.openContext();
  f.client.dispose();
  await assert.rejects(pending, /closed/);
  assert.throws(() => context.append("b", "text", "sealed"), /closed/);
  assert.throws(() => f.client.receive(new Uint8Array()), /closed/);
  assert.deepEqual(f.client.finish(), []);
});

test("a throwing transport rejects with its error and the client sends no later request", async () => {
  let writes = 0;
  const client = new TuiClient({ write() { writes++; throw new Error("transport unavailable"); } });
  await assert.rejects(client.negotiate(), /transport unavailable/);
  await assert.rejects(client.negotiate(), /closed/);
  assert.equal(writes, 1);
});

test("an immediate response during write resolves the already registered control request", async () => {
  const terminal = new TerminalProtocolEndpoint({ completeBaselineSupported: true });
  const client = new TuiClient({ write(bytes) {
    for (const frame of terminal.push(bytes).responseFrames) client.receive(frame);
  } });
  try {
    assert.equal(await client.negotiate(), true);
    const first = await client.openContext();
    const second = await client.openContext();
    assert.notEqual(first.id, second.id);
    first.append("same-block-id", "first", "sealed");
    second.append("same-block-id", "second", "sealed");
    assert.equal(terminal.context(first.id)?.blocks[0].content.data, "first");
    assert.equal(terminal.context(second.id)?.blocks[0].content.data, "second");
    await first.close();
    second.append("still-open", "tail", "sealed");
    await second.close();
  } finally { client.dispose(); }
});

test("matched capability and open errors reject with the terminal's error code", async () => {
  const f = fixture();
  try {
    const query = f.client.negotiate();
    f.respond({ version: 1, kind: "capability.response", request_id: "1",
      body: { outcome: "error", error: { code: "internal_error" } } });
    await assert.rejects(query, /internal_error/);
    await assert.rejects(f.client.openContext(), /Positive capability/);
    const supported = f.client.negotiate();
    f.respond({ version: 1, kind: "capability.response", request_id: "2", body: { outcome: "supported", optional_content_types: [] } });
    await supported;
    const opening = f.client.openContext();
    f.respond({ version: 1, kind: "context.open.response", request_id: "3",
      body: { outcome: "error", error: { code: "resource_exhausted" } } });
    await assert.rejects(opening, /resource_exhausted/);
  } finally { f.client.dispose(); }
});

test("ending a partial response reports its diagnostic and rejects the waiting request", async () => {
  const f = fixture();
  const query = f.client.negotiate();
  const frame = encodeMessageFrames({ version: 1, kind: "capability.response", request_id: "1",
    body: { outcome: "supported", optional_content_types: [] } }, 1)[0];
  f.client.receive(frame.subarray(0, frame.length - 2));
  assert(f.client.finish().some(event => event.type === "error"));
  await assert.rejects(query, /closed/);
});

test("an existing Context cannot send while a new capability query is pending or returns unsupported", async () => {
  const f = fixture();
  try {
    const context = await open(f);
    const query = f.client.negotiate();
    assert.throws(() => context.append("b", "text", "sealed"), /Positive capability/);
    f.respond({ version: 1, kind: "capability.response", request_id: "3", body: { outcome: "unsupported" } });
    assert.equal(await query, false);
    assert.throws(() => context.append("b", "text", "sealed"), /Positive capability/);
    assert.equal(f.sent.some(message => message.kind.startsWith("block.")), false);
  } finally { f.client.dispose(); }
});
