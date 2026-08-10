import assert from "node:assert/strict";
import test from "node:test";

import {
  MessageCodecError,
  ProtocolStreamDecoder,
  deserializeMessage,
  encodeMessageFrames,
  type DecoderEvent,
  type Message,
} from "./index.ts";

const messages: readonly Message[] = [
  {
    version: 1,
    kind: "capability.query",
    request_id: "request-1",
    body: {},
  },
  {
    version: 1,
    kind: "capability.response",
    request_id: "request-1",
    body: { outcome: "supported", optional_content_types: [] },
  },
  {
    version: 1,
    kind: "capability.response",
    request_id: "request-2",
    body: { outcome: "unsupported" },
  },
  {
    version: 1,
    kind: "capability.response",
    request_id: "request-3",
    body: {
      outcome: "error",
      error: { code: "internal_error", message: "not available" },
    },
  },
  {
    version: 1,
    kind: "context.open",
    request_id: "request-4",
    body: {},
  },
  {
    version: 1,
    kind: "context.open.response",
    request_id: "request-4",
    context_id: "context-1",
    body: { outcome: "opened" },
  },
  {
    version: 1,
    kind: "context.open.response",
    request_id: "request-5",
    body: {
      outcome: "error",
      error: { code: "resource_exhausted" },
    },
  },
  {
    version: 1,
    kind: "context.close",
    request_id: "request-6",
    context_id: "context-1",
    body: {},
  },
  {
    version: 1,
    kind: "context.close.response",
    request_id: "request-6",
    context_id: "context-1",
    body: { outcome: "closed" },
  },
  {
    version: 1,
    kind: "context.close.response",
    request_id: "request-7",
    context_id: "missing",
    body: {
      outcome: "error",
      error: { code: "context_not_open" },
    },
  },
  {
    version: 1,
    kind: "block.append",
    operation_id: "1",
    context_id: "context-1",
    body: {
      block_id: "thinking",
      lifecycle: "mutable",
      content: { type: "text/plain", data: "Searching…" },
    },
  },
  {
    version: 1,
    kind: "block.update",
    operation_id: "2",
    context_id: "context-1",
    body: {
      block_id: "thinking",
      content: { type: "text/plain", data: "Search complete." },
    },
  },
  {
    version: 1,
    kind: "block.seal",
    operation_id: "3",
    context_id: "context-1",
    body: { block_id: "thinking" },
  },
  {
    version: 1,
    kind: "protocol.error",
    operation_id: "4",
    context_id: "context-1",
    body: { code: "block_sealed", message: "Block is already sealed." },
  },
];

test("every baseline Message schema round-trips through OSC framing", () => {
  const decoder = new ProtocolStreamDecoder();

  for (const [index, message] of messages.entries()) {
    const frames = encodeMessageFrames(message, index + 1);
    assert.equal(frames.length, 1);
    assert.deepEqual(decoder.push(frames[0]), [
      { type: "message", frameId: index + 1, message },
    ]);
  }
});

test("a fragmented Message survives a write boundary after every byte", () => {
  const message: Message = {
    version: 1,
    kind: "block.update",
    operation_id: "100",
    context_id: "context-stream",
    body: {
      block_id: "thinking",
      content: { type: "text/plain", data: "思考🙂".repeat(1200) },
    },
  };
  const frames = encodeMessageFrames(message, 42);
  assert.ok(frames.length > 1);

  const decoder = new ProtocolStreamDecoder();
  const events: DecoderEvent[] = [];
  const stream = concatenate(frames);
  for (let offset = 0; offset < stream.length; offset += 1) {
    events.push(...decoder.push(stream.subarray(offset, offset + 1)));
  }

  assert.deepEqual(events, [{ type: "message", frameId: 42, message }]);
});

test("strict decoding rejects invalid UTF-8, BOM, and tested JSON failures", () => {
  assertBytesError(Uint8Array.of(0xc3, 0x28), "invalid_utf8");
  assertBytesError(
    concatenate([
      Uint8Array.of(0xef, 0xbb, 0xbf),
      new TextEncoder().encode(
        '{"version":1,"kind":"capability.query","request_id":"1","body":{}}',
      ),
    ]),
    "invalid_utf8",
  );
  assertMessageError(
    '{"version":1,"version":1,"kind":"capability.query","request_id":"1","body":{}}',
    "invalid_json",
  );
  assertMessageError(
    '{"version":1,"kind":"capability.query","request_id":"1","extra":true,"body":{}}',
    "invalid_schema",
  );
  assertMessageError(
    '{"version":1,"kind":"capability.query","request_id":"\\uD800","body":{}}',
    "invalid_json",
  );
  assertMessageError(
    '{"version":1,"kind":"protocol.error","operation_id":"1","context_id":"ctx","body":{"code":"request_id_conflict"}}',
    "invalid_schema",
  );
});

test("a framing failure is isolated and the next valid frame is decoded", () => {
  const decoder = new ProtocolStreamDecoder();
  const malformed = new TextEncoder().encode(
    "\u001B]9002;1;7;0;0;!!!!\u001B\\",
  );
  const valid = encodeMessageFrames(messages[0], 8)[0];
  const events = decoder.push(concatenate([malformed, valid]));

  assert.equal(events[0]?.type, "error");
  assert.equal(
    events[0]?.type === "error" ? events[0].layer : undefined,
    "framing",
  );
  assert.deepEqual(events[1], {
    type: "message",
    frameId: 8,
    message: messages[0],
  });
});

test("ordinary output between fragments abandons only that Message", () => {
  const longMessage: Message = {
    version: 1,
    kind: "block.update",
    operation_id: "101",
    context_id: "context-stream",
    body: {
      block_id: "thinking",
      content: { type: "text/plain", data: "x".repeat(4000) },
    },
  };
  const frames = encodeMessageFrames(longMessage, 9);
  const decoder = new ProtocolStreamDecoder();

  assert.deepEqual(decoder.push(frames[0]), []);
  const interruption = decoder.push(new TextEncoder().encode("ordinary"));
  assert.equal(interruption.length, 1);
  assert.equal(interruption[0]?.type, "error");

  const orphan = decoder.push(frames[1]);
  assert.equal(orphan.length, 1);
  assert.equal(orphan[0]?.type, "error");

  assert.deepEqual(decoder.push(encodeMessageFrames(messages[0], 10)[0]), [
    { type: "message", frameId: 10, message: messages[0] },
  ]);
});

function assertMessageError(
  source: string,
  expectedCode: MessageCodecError["code"],
): void {
  assertBytesError(new TextEncoder().encode(source), expectedCode);
}

function assertBytesError(
  source: Uint8Array,
  expectedCode: MessageCodecError["code"],
): void {
  assert.throws(
    () => deserializeMessage(source),
    (error: unknown) => {
      assert.ok(error instanceof MessageCodecError);
      assert.equal(error.code, expectedCode);
      return true;
    },
  );
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
