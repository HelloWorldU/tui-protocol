import assert from "node:assert/strict";
import test from "node:test";

import {
  FrameCodecError,
  MAX_MESSAGE_BYTES,
  MessageCodecError,
  ProtocolStreamDecoder,
  deserializeMessage,
  encodeMessageFrames,
  serializeMessage,
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
    kind: "block.extend",
    operation_id: "3",
    context_id: "context-1",
    body: {
      block_id: "thinking",
      base_operation_id: "2",
      fragment: " More detail.",
    },
  },
  {
    version: 1,
    kind: "block.replace_suffix",
    operation_id: "4",
    context_id: "context-1",
    body: {
      block_id: "thinking",
      base_operation_id: "3",
      retain: 7,
      replacement: "",
    },
  },
  {
    version: 1,
    kind: "block.seal",
    operation_id: "5",
    context_id: "context-1",
    body: { block_id: "thinking" },
  },
  {
    version: 1,
    kind: "protocol.error",
    operation_id: "6",
    context_id: "context-1",
    body: { code: "block_sealed", message: "Block is already sealed." },
  },
];

const goldenMessage: Message = {
  version: 1,
  kind: "capability.query",
  request_id: "r",
  body: {},
};
const goldenJson =
  '{"version":1,"kind":"capability.query","request_id":"r","body":{}}';
const goldenOsc =
  "\u001B]9002;1;7;0;0;" +
  "eyJ2ZXJzaW9uIjoxLCJraW5kIjoiY2FwYWJpbGl0eS5xdWVyeSIs" +
  "InJlcXVlc3RfaWQiOiJyIiwiYm9keSI6e319\u001B\\";
const goldenUpdate: Message = {
  version: 1,
  kind: "block.update",
  operation_id: "42",
  context_id: "ctx-1",
  body: {
    block_id: "thinking-1",
    content: { type: "text/plain", data: "complete replacement text" },
  },
};
const goldenUpdateJson =
  '{"version":1,"kind":"block.update","operation_id":"42",' +
  '"context_id":"ctx-1","body":{"block_id":"thinking-1",' +
  '"content":{"type":"text/plain","data":"complete replacement text"}}}';
const goldenExtend: Message = {
  version: 1,
  kind: "block.extend",
  operation_id: "43",
  context_id: "ctx-1",
  body: {
    block_id: "thinking-1",
    base_operation_id: "42",
    fragment: " additional text",
  },
};
const goldenExtendJson =
  '{"version":1,"kind":"block.extend","operation_id":"43",' +
  '"context_id":"ctx-1","body":{"block_id":"thinking-1",' +
  '"base_operation_id":"42","fragment":" additional text"}}';
const goldenReplaceSuffix: Message = {
  version: 1,
  kind: "block.replace_suffix",
  operation_id: "44",
  context_id: "ctx-1",
  body: {
    block_id: "thinking-1",
    base_operation_id: "43",
    retain: 12,
    replacement: "revised ending",
  },
};
const goldenReplaceSuffixJson =
  '{"version":1,"kind":"block.replace_suffix","operation_id":"44",' +
  '"context_id":"ctx-1","body":{"block_id":"thinking-1",' +
  '"base_operation_id":"43","retain":12,' +
  '"replacement":"revised ending"}}';

test("fixed JSON and OSC fixtures match the draft wire format", () => {
  assert.equal(
    new TextDecoder().decode(serializeMessage(goldenMessage)),
    goldenJson,
  );
  assert.deepEqual(
    deserializeMessage(new TextEncoder().encode(goldenJson)),
    goldenMessage,
  );
  assert.deepEqual(encodeMessageFrames(goldenMessage, 7), [
    new TextEncoder().encode(goldenOsc),
  ]);

  const decoder = new ProtocolStreamDecoder();
  assert.deepEqual(decoder.push(new TextEncoder().encode(goldenOsc)), [
    { type: "message", frameId: 7, message: goldenMessage },
  ]);
  assert.equal(
    new TextDecoder().decode(serializeMessage(goldenUpdate)),
    goldenUpdateJson,
  );
  assert.deepEqual(
    deserializeMessage(new TextEncoder().encode(goldenUpdateJson)),
    goldenUpdate,
  );
  assert.equal(
    new TextDecoder().decode(serializeMessage(goldenExtend)),
    goldenExtendJson,
  );
  assert.deepEqual(
    deserializeMessage(new TextEncoder().encode(goldenExtendJson)),
    goldenExtend,
  );
  assert.equal(
    new TextDecoder().decode(serializeMessage(goldenReplaceSuffix)),
    goldenReplaceSuffixJson,
  );
  assert.deepEqual(
    deserializeMessage(new TextEncoder().encode(goldenReplaceSuffixJson)),
    goldenReplaceSuffix,
  );
});

test("serialization snapshots data instead of invoking inherited toJSON", () => {
  const prototype = {
    toJSON: () => ({ ...goldenMessage, extra: true }),
  };
  const input = Object.assign(Object.create(prototype), goldenMessage) as Message;

  assert.equal(new TextDecoder().decode(serializeMessage(input)), goldenJson);
});

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

test("a fragmented Message decodes when input arrives one byte at a time", () => {
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

test("framing accepts the byte limit and rejects one byte beyond it", () => {
  const empty: Message = {
    version: 1,
    kind: "block.update",
    operation_id: "limit",
    context_id: "context-limit",
    body: {
      block_id: "block-limit",
      content: { type: "text/plain", data: "" },
    },
  };
  const overhead = serializeMessage(empty).length;
  const exact: Message = {
    ...empty,
    body: {
      ...empty.body,
      content: {
        type: "text/plain",
        data: "a".repeat(MAX_MESSAGE_BYTES - overhead),
      },
    },
  };

  assert.equal(serializeMessage(exact).length, MAX_MESSAGE_BYTES);
  const frames = encodeMessageFrames(exact, 43);
  assert.equal(frames.length, 342);
  const decoder = new ProtocolStreamDecoder();
  const events = frames.flatMap((frame) => decoder.push(frame));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "message");

  const tooLarge: Message = {
    ...exact,
    body: {
      ...exact.body,
      content: {
        type: "text/plain",
        data: `${exact.body.content.data}a`,
      },
    },
  };
  assert.throws(() => encodeMessageFrames(tooLarge, 44), FrameCodecError);
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

test("a schema-invalid query exposes its valid request ID, while an empty request ID exposes none", () => {
  const correlated = captureMessageError(
    '{"version":1,"kind":"capability.query","request_id":"request-invalid","body":{"extra":true}}',
  );
  assert.equal(correlated.code, "invalid_schema");
  assert.equal(correlated.identity?.category, "control");
  if (correlated.identity?.category !== "control") {
    throw new Error("Expected a reliable control request identity.");
  }
  assert.equal(correlated.identity.kind, "capability.query");
  assert.equal(correlated.identity.request_id, "request-invalid");
  assert.ok(correlated.identity.fingerprint.length > 0);

  const uncorrelated = captureMessageError(
    '{"version":1,"kind":"capability.query","request_id":"","body":{"extra":true}}',
  );
  assert.equal(uncorrelated.code, "invalid_schema");
  assert.equal(uncorrelated.identity, undefined);
});

test("an unrecognized version or Message kind exposes no request identity", () => {
  const unknownVersion = captureMessageError(
    '{"version":2,"kind":"capability.query","request_id":"request-1","body":{}}',
  );
  const unknownKind = captureMessageError(
    '{"version":1,"kind":"unknown.request","request_id":"request-2","body":{}}',
  );

  assert.equal(unknownVersion.identity, undefined);
  assert.equal(unknownKind.identity, undefined);
});

test("an Extend with an empty fragment is rejected with its valid Operation identity", () => {
  const error = captureMessageError(
    '{"version":1,"kind":"block.extend","operation_id":"extend-empty","context_id":"ctx","body":{"block_id":"thinking","base_operation_id":"1","fragment":""}}',
  );

  assert.equal(error.code, "invalid_schema");
  assert.deepEqual(error.identity, {
    category: "operation",
    kind: "block.extend",
    operation_id: "extend-empty",
    context_id: "ctx",
  });
});

test("ReplaceSuffix rejects negative, fractional, and unsafe retain values with its valid Operation identity", () => {
  for (const retain of ["-1", "1.5", "9007199254740992"]) {
    const error = captureMessageError(
      `{"version":1,"kind":"block.replace_suffix","operation_id":"replace-invalid","context_id":"ctx","body":{"block_id":"thinking","base_operation_id":"1","retain":${retain},"replacement":"fixed"}}`,
    );

    assert.equal(error.code, "invalid_schema");
    assert.deepEqual(error.identity, {
      category: "operation",
      kind: "block.replace_suffix",
      operation_id: "replace-invalid",
      context_id: "ctx",
    });
  }
});

test("the same invalid control request gets the same fingerprint when its JSON fields are reordered", () => {
  const first = captureMessageError(
    '{"version":1,"kind":"context.open","request_id":"same-request","body":{"extra":true}}',
  );
  const reordered = captureMessageError(
    '{"body":{"extra":true},"request_id":"same-request","kind":"context.open","version":1}',
  );

  assert.equal(first.identity?.category, "control");
  assert.equal(reordered.identity?.category, "control");
  assert.equal(
    first.identity?.category === "control" ? first.identity.fingerprint : "",
    reordered.identity?.category === "control"
      ? reordered.identity.fingerprint
      : "different",
  );
});

test("after rejecting a malformed frame, the decoder still decodes the next valid frame", () => {
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

test("an invalid OSC control does not swallow the next valid frame", () => {
  const decoder = new ProtocolStreamDecoder();
  const malformed = new TextEncoder().encode(
    "\u001B]9002;1;7;0;0;AAAA\u001B\u0007",
  );
  const events = decoder.push(
    concatenate([malformed, new TextEncoder().encode(goldenOsc)]),
  );

  assert.equal(events[0]?.type, "error");
  assert.equal(
    events[0]?.type === "error" ? events[0].layer : undefined,
    "framing",
  );
  assert.deepEqual(events[1], {
    type: "message",
    frameId: 7,
    message: goldenMessage,
  });
});

test("ordinary output between Message fragments rejects that Message but not the next valid one", () => {
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

test("mixed decoding preserves ordinary text and another OSC around a protocol Message in byte-stream order", () => {
  const decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  const title = "\u001B]2;working\u001B\\";
  const events = decoder.push(
    concatenate([
      new TextEncoder().encode("before"),
      new TextEncoder().encode(goldenOsc),
      new TextEncoder().encode(`between${title}after`),
    ]),
  );

  assert.equal(events.length, 3);
  assert.equal(events[0]?.type, "ordinary");
  assert.equal(
    events[0]?.type === "ordinary"
      ? new TextDecoder().decode(events[0].data)
      : undefined,
    "before",
  );
  assert.deepEqual(events[1], {
    type: "message",
    frameId: 7,
    message: goldenMessage,
  });
  assert.equal(events[2]?.type, "ordinary");
  assert.equal(
    events[2]?.type === "ordinary"
      ? new TextDecoder().decode(events[2].data)
      : undefined,
    `between${title}after`,
  );
});

test("every split of tested mixed bytes preserves the same ordinary data and protocol Message order", () => {
  const stream = concatenate([
    new TextEncoder().encode("前🙂\u001B[31m"),
    new TextEncoder().encode(goldenOsc),
    new TextEncoder().encode("\u001B]2;working\u001B\\后"),
  ]);
  const wholeDecoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  const expected = normalizeDecoderEvents([
    ...wholeDecoder.push(stream),
    ...wholeDecoder.finish(),
  ]);

  for (let split = 0; split <= stream.length; split += 1) {
    const decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
    const actual = normalizeDecoderEvents([
      ...decoder.push(stream.subarray(0, split)),
      ...decoder.push(stream.subarray(split)),
      ...decoder.finish(),
    ]);
    assert.deepEqual(actual, expected, `mixed-stream split at byte ${split}`);
  }
});

test("mixed decoding preserves the exact bytes of a tested BEL-ended unrelated OSC", () => {
  const decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  const ordinary = Uint8Array.from([
    0xff,
    0x1b,
    0x5d,
    0x32,
    0x3b,
    0x74,
    0x69,
    0x74,
    0x6c,
    0x65,
    0x07,
    0x80,
  ]);

  const events = [...decoder.push(ordinary), ...decoder.finish()];

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "ordinary");
  assert.deepEqual(
    events[0]?.type === "ordinary" ? events[0].data : undefined,
    ordinary,
  );
});

test("mixed decoding consumes a malformed protocol OSC instead of displaying it as ordinary data", () => {
  const decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  const events = decoder.push(
    new TextEncoder().encode(
      "before\u001B]9002;1;7;0;0;!!!!\u001B\\after",
    ),
  );

  assert.deepEqual(events.map((event) => event.type), [
    "ordinary",
    "error",
    "ordinary",
  ]);
  assert.equal(
    events[0]?.type === "ordinary"
      ? new TextDecoder().decode(events[0].data)
      : undefined,
    "before",
  );
  assert.equal(events[1]?.type === "error" ? events[1].layer : undefined, "framing");
  assert.equal(
    events[2]?.type === "ordinary"
      ? new TextDecoder().decode(events[2].data)
      : undefined,
    "after",
  );
});

function assertMessageError(
  source: string,
  expectedCode: MessageCodecError["code"],
): void {
  assertBytesError(new TextEncoder().encode(source), expectedCode);
}

function captureMessageError(source: string): MessageCodecError {
  try {
    deserializeMessage(new TextEncoder().encode(source));
  } catch (error: unknown) {
    assert.ok(error instanceof MessageCodecError);
    return error;
  }
  throw new Error("Expected Message decoding to fail.");
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

type NormalizedDecoderEvent =
  | Exclude<DecoderEvent, { readonly type: "ordinary" }>
  | { readonly type: "ordinary"; readonly data: number[] };

function normalizeDecoderEvents(
  events: readonly DecoderEvent[],
): readonly NormalizedDecoderEvent[] {
  const normalized: NormalizedDecoderEvent[] = [];
  for (const event of events) {
    if (event.type !== "ordinary") {
      normalized.push(event);
      continue;
    }
    const previous = normalized.at(-1);
    if (previous?.type === "ordinary") {
      previous.data.push(...event.data);
    } else {
      normalized.push({ type: "ordinary", data: [...event.data] });
    }
  }
  return normalized;
}
