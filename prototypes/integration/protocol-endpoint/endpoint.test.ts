import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  ProtocolStreamDecoder,
  encodeMessageFrames,
  type Message,
} from "../../reference-codec/index.ts";
import {
  ProtocolEndpointError,
  TerminalProtocolEndpoint,
  type AppliedBlockOperation,
  type EndpointResult,
} from "./endpoint.ts";

test("capability query bytes split across two writes produce a supported response Message", () => {
  const endpoint = supportedEndpoint();
  const bytes = encodeInput(
    {
      version: 1,
      kind: "capability.query",
      request_id: "capability-1",
      body: {},
    },
    10,
  );
  const splitAt = Math.floor(bytes.length / 2);

  assert.deepEqual(endpoint.push(bytes.subarray(0, splitAt)), emptyResult());
  const result = endpoint.push(bytes.subarray(splitAt));

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(decodeResponses(result), [
    {
      version: 1,
      kind: "capability.response",
      request_id: "capability-1",
      body: { outcome: "supported", optional_content_types: [] },
    },
  ]);
});

test("a host without complete version 1 support returns unsupported response bytes", () => {
  const endpoint = new TerminalProtocolEndpoint({
    completeBaselineSupported: false,
  });

  const result = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "capability.query",
        request_id: "capability-unsupported",
        body: {},
      },
      1,
    ),
  );

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(decodeResponses(result), [
    {
      version: 1,
      kind: "capability.response",
      request_id: "capability-unsupported",
      body: { outcome: "unsupported" },
    },
  ]);
});

test("Context and Block Operation bytes update Session state, while a rejected Update returns protocol.error bytes", () => {
  const endpoint = supportedEndpoint();
  const contextId = openContext(endpoint);

  const operations: readonly Message[] = [
    {
      version: 1,
      kind: "block.append",
      operation_id: "1",
      context_id: contextId,
      body: {
        block_id: "thinking",
        lifecycle: "mutable",
        content: { type: "text/plain", data: "partial" },
      },
    },
    {
      version: 1,
      kind: "block.update",
      operation_id: "2",
      context_id: contextId,
      body: {
        block_id: "thinking",
        content: { type: "text/plain", data: "complete" },
      },
    },
    {
      version: 1,
      kind: "block.seal",
      operation_id: "3",
      context_id: contextId,
      body: { block_id: "thinking" },
    },
  ];
  const applied = endpoint.push(
    concatenate(operations.map((message, index) => encodeInput(message, index + 2))),
  );

  assert.deepEqual(applied, emptyResult());
  assert.deepEqual(endpoint.context(contextId), {
    id: contextId,
    state: "open",
    blocks: [
      {
        id: "thinking",
        lifecycle: "sealed",
        content: { type: "text/plain", data: "complete" },
      },
    ],
  });

  const rejected = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "block.update",
        operation_id: "4",
        context_id: contextId,
        body: {
          block_id: "thinking",
          content: { type: "text/plain", data: "too late" },
        },
      },
      5,
    ),
  );

  assert.deepEqual(rejected.diagnostics, []);
  assert.deepEqual(decodeResponses(rejected), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "4",
      context_id: contextId,
      body: { code: "block_sealed" },
    },
  ]);
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "complete",
  );
});

test("Extend bytes append only on the named content state, and Update restores a broken chain", () => {
  const applied: AppliedBlockOperation[] = [];
  const endpoint = new TerminalProtocolEndpoint({
    completeBaselineSupported: true,
    onOperationApplied: (operation) => applied.push(operation),
  });
  const contextId = openContext(endpoint);

  const successful = endpoint.push(
    concatenate([
      encodeInput(
        {
          version: 1,
          kind: "block.append",
          operation_id: "extend-1",
          context_id: contextId,
          body: {
            block_id: "thinking",
            lifecycle: "mutable",
            content: { type: "text/plain", data: "Start" },
          },
        },
        60,
      ),
      encodeInput(
        {
          version: 1,
          kind: "block.extend",
          operation_id: "extend-2",
          context_id: contextId,
          body: {
            block_id: "thinking",
            base_operation_id: "extend-1",
            fragment: "🙂",
          },
        },
        61,
      ),
    ]),
  );

  assert.deepEqual(successful, emptyResult());
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "Start🙂",
  );

  const mismatch = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "block.extend",
        operation_id: "extend-3",
        context_id: contextId,
        body: {
          block_id: "thinking",
          base_operation_id: "extend-1",
          fragment: " stale",
        },
      },
      62,
    ),
  );
  assert.deepEqual(decodeResponses(mismatch), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "extend-3",
      context_id: contextId,
      body: { code: "content_state_mismatch" },
    },
  ]);
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "Start🙂",
  );

  assert.deepEqual(
    endpoint.push(
      concatenate([
        encodeInput(
          {
            version: 1,
            kind: "block.update",
            operation_id: "extend-4",
            context_id: contextId,
            body: {
              block_id: "thinking",
              content: { type: "text/plain", data: "Recovered" },
            },
          },
          63,
        ),
        encodeInput(
          {
            version: 1,
            kind: "block.extend",
            operation_id: "extend-5",
            context_id: contextId,
            body: {
              block_id: "thinking",
              base_operation_id: "extend-4",
              fragment: " safely",
            },
          },
          64,
        ),
      ]),
    ),
    emptyResult(),
  );
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "Recovered safely",
  );
  assert.deepEqual(
    applied.map((operation) => operation.operation_id),
    ["extend-1", "extend-2", "extend-4", "extend-5"],
  );
});

test("ReplaceSuffix bytes replace a Unicode-scalar suffix, while an out-of-range boundary changes nothing", () => {
  const applied: AppliedBlockOperation[] = [];
  const endpoint = new TerminalProtocolEndpoint({
    completeBaselineSupported: true,
    onOperationApplied: (operation) => applied.push(operation),
  });
  const contextId = openContext(endpoint);

  assert.deepEqual(
    endpoint.push(
      concatenate([
        encodeInput(
          {
            version: 1,
            kind: "block.append",
            operation_id: "replace-1",
            context_id: contextId,
            body: {
              block_id: "thinking",
              lifecycle: "mutable",
              content: { type: "text/plain", data: "A🙂 old" },
            },
          },
          65,
        ),
        encodeInput(
          {
            version: 1,
            kind: "block.replace_suffix",
            operation_id: "replace-2",
            context_id: contextId,
            body: {
              block_id: "thinking",
              base_operation_id: "replace-1",
              retain: 2,
              replacement: " new",
            },
          },
          66,
        ),
      ]),
    ),
    emptyResult(),
  );
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "A🙂 new",
  );

  const rejected = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "block.replace_suffix",
        operation_id: "replace-3",
        context_id: contextId,
        body: {
          block_id: "thinking",
          base_operation_id: "replace-2",
          retain: 6,
          replacement: " invalid",
        },
      },
      67,
    ),
  );
  assert.deepEqual(decodeResponses(rejected), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "replace-3",
      context_id: contextId,
      body: { code: "invalid_content_boundary" },
    },
  ]);
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "A🙂 new",
  );
  assert.deepEqual(
    applied.map((operation) => operation.operation_id),
    ["replace-1", "replace-2"],
  );
});

test("successful Block Operations reach the host in byte-stream order, while a rejected Update does not", () => {
  const applied: AppliedBlockOperation[] = [];
  const endpoint = new TerminalProtocolEndpoint({
    completeBaselineSupported: true,
    onOperationApplied: (operation) => applied.push(operation),
  });
  const contextId = openContext(endpoint);
  const operations: readonly Message[] = [
    {
      version: 1,
      kind: "block.append",
      operation_id: "host-1",
      context_id: contextId,
      body: {
        block_id: "thinking",
        lifecycle: "mutable",
        content: { type: "text/plain", data: "draft" },
      },
    },
    {
      version: 1,
      kind: "block.update",
      operation_id: "host-2",
      context_id: contextId,
      body: {
        block_id: "thinking",
        content: { type: "text/plain", data: "final" },
      },
    },
    {
      version: 1,
      kind: "block.seal",
      operation_id: "host-3",
      context_id: contextId,
      body: { block_id: "thinking" },
    },
    {
      version: 1,
      kind: "block.update",
      operation_id: "host-4",
      context_id: contextId,
      body: {
        block_id: "thinking",
        content: { type: "text/plain", data: "too late" },
      },
    },
  ];

  const result = endpoint.push(
    concatenate(
      operations.map((message, index) => encodeInput(message, index + 30)),
    ),
  );

  assert.deepEqual(
    applied.map((operation) => operation.kind),
    ["block.append", "block.update", "block.seal"],
  );
  assert.deepEqual(decodeResponses(result), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "host-4",
      context_id: contextId,
      body: { code: "block_sealed" },
    },
  ]);
});

test("a host capacity rejection returns resource_exhausted without changing the Block or reporting the Update as applied", () => {
  const applied: AppliedBlockOperation[] = [];
  const endpoint = new TerminalProtocolEndpoint({
    completeBaselineSupported: true,
    onOperationPrepared: (operation) =>
      operation.kind === "block.update" ? "resource_exhausted" : undefined,
    onOperationApplied: (operation) => applied.push(operation),
  });
  const contextId = openContext(endpoint);

  assert.deepEqual(
    endpoint.push(
      encodeInput(
        {
          version: 1,
          kind: "block.append",
          operation_id: "capacity-1",
          context_id: contextId,
          body: {
            block_id: "thinking",
            lifecycle: "mutable",
            content: { type: "text/plain", data: "draft" },
          },
        },
        40,
      ),
    ),
    emptyResult(),
  );

  const rejected = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "block.update",
        operation_id: "capacity-2",
        context_id: contextId,
        body: {
          block_id: "thinking",
          content: { type: "text/plain", data: "too large" },
        },
      },
      41,
    ),
  );

  assert.deepEqual(rejected.diagnostics, []);
  assert.deepEqual(decodeResponses(rejected), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "capacity-2",
      context_id: contextId,
      body: { code: "resource_exhausted" },
    },
  ]);
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "draft",
  );
  assert.deepEqual(
    applied.map((operation) => operation.operation_id),
    ["capacity-1"],
  );
});

test("a thrown host preparation failure returns internal_error, leaves the Block unchanged, and does not block the next Operation", () => {
  const endpoint = new TerminalProtocolEndpoint({
    completeBaselineSupported: true,
    onOperationPrepared: (operation) => {
      if (
        operation.kind === "block.update" &&
        operation.body.content.data === "preflight failure"
      ) {
        throw new Error("renderer preflight failed");
      }
      return undefined;
    },
  });
  const contextId = openContext(endpoint);
  endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "block.append",
        operation_id: "failure-1",
        context_id: contextId,
        body: {
          block_id: "thinking",
          lifecycle: "mutable",
          content: { type: "text/plain", data: "draft" },
        },
      },
      50,
    ),
  );

  const failed = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "block.update",
        operation_id: "failure-2",
        context_id: contextId,
        body: {
          block_id: "thinking",
          content: { type: "text/plain", data: "preflight failure" },
        },
      },
      51,
    ),
  );

  assert.deepEqual(failed.diagnostics, [
    { layer: "host", reason: "renderer preflight failed" },
  ]);
  assert.deepEqual(decodeResponses(failed), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "failure-2",
      context_id: contextId,
      body: { code: "internal_error" },
    },
  ]);
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "draft",
  );

  assert.deepEqual(
    endpoint.push(
      encodeInput(
        {
          version: 1,
          kind: "block.update",
          operation_id: "failure-3",
          context_id: contextId,
          body: {
            block_id: "thinking",
            content: { type: "text/plain", data: "complete" },
          },
        },
        52,
      ),
    ),
    emptyResult(),
  );
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "complete",
  );
});

test("after malformed framing reports a diagnostic, later valid query bytes still produce a response", () => {
  const endpoint = supportedEndpoint();
  const malformed = new TextEncoder().encode(
    "\u001B]9002;1;7;0;0;!!!!\u001B\\",
  );
  const valid = encodeInput(
    {
      version: 1,
      kind: "capability.query",
      request_id: "after-error",
      body: {},
    },
    8,
  );

  const result = endpoint.push(concatenate([malformed, valid]));

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.layer, "framing");
  assert.deepEqual(endpoint.contexts(), []);
  assert.deepEqual(decodeResponses(result), [
    {
      version: 1,
      kind: "capability.response",
      request_id: "after-error",
      body: { outcome: "supported", optional_content_types: [] },
    },
  ]);
});

test("an invalid capability query with a valid request ID returns invalid_message, while corrected reuse returns request_id_conflict", () => {
  const endpoint = supportedEndpoint();
  const invalid = encodeRawJson(
    '{"version":1,"kind":"capability.query","request_id":"invalid-1","body":{"extra":true}}',
    20,
  );

  const first = endpoint.push(invalid);
  assert.equal(first.diagnostics.length, 1);
  assert.equal(first.diagnostics[0]?.layer, "message");
  assert.deepEqual(decodeResponses(first), [
    {
      version: 1,
      kind: "capability.response",
      request_id: "invalid-1",
      body: { outcome: "error", error: { code: "invalid_message" } },
    },
  ]);

  const retry = endpoint.push(
    encodeRawJson(
      '{"body":{"extra":true},"request_id":"invalid-1","kind":"capability.query","version":1}',
      27,
    ),
  );
  assert.deepEqual(decodeResponses(retry), decodeResponses(first));

  const corrected = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "capability.query",
        request_id: "invalid-1",
        body: {},
      },
      21,
    ),
  );
  assert.deepEqual(decodeResponses(corrected), [
    {
      version: 1,
      kind: "capability.response",
      request_id: "invalid-1",
      body: {
        outcome: "error",
        error: { code: "request_id_conflict" },
      },
    },
  ]);
});

test("invalid Context requests with valid IDs return their matching error responses without closing the Context", () => {
  const endpoint = supportedEndpoint();
  const invalidOpen = endpoint.push(
    encodeRawJson(
      '{"version":1,"kind":"context.open","request_id":"invalid-open","body":{"extra":true}}',
      25,
    ),
  );
  assert.deepEqual(decodeResponses(invalidOpen), [
    {
      version: 1,
      kind: "context.open.response",
      request_id: "invalid-open",
      body: { outcome: "error", error: { code: "invalid_message" } },
    },
  ]);
  assert.deepEqual(endpoint.contexts(), []);

  const contextId = openContext(endpoint);
  const invalidClose = endpoint.push(
    encodeRawJson(
      JSON.stringify({
        version: 1,
        kind: "context.close",
        request_id: "invalid-close",
        context_id: contextId,
        body: { extra: true },
      }),
      26,
    ),
  );
  assert.deepEqual(decodeResponses(invalidClose), [
    {
      version: 1,
      kind: "context.close.response",
      request_id: "invalid-close",
      context_id: contextId,
      body: { outcome: "error", error: { code: "invalid_message" } },
    },
  ]);
  assert.equal(endpoint.context(contextId)?.state, "open");
});

test("an invalid Block Operation with valid IDs returns invalid_message and prevents reuse of its operation ID", () => {
  const endpoint = supportedEndpoint();
  const contextId = openContext(endpoint);
  const invalid = encodeRawJson(
    JSON.stringify({
      version: 1,
      kind: "block.update",
      operation_id: "invalid-operation-1",
      context_id: contextId,
      body: { block_id: "missing-content" },
    }),
    22,
  );

  const rejected = endpoint.push(invalid);
  assert.equal(rejected.diagnostics.length, 1);
  assert.equal(rejected.diagnostics[0]?.layer, "message");
  assert.deepEqual(decodeResponses(rejected), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "invalid-operation-1",
      context_id: contextId,
      body: { code: "invalid_message" },
    },
  ]);

  const reused = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "block.append",
        operation_id: "invalid-operation-1",
        context_id: contextId,
        body: {
          block_id: "would-be-valid",
          lifecycle: "sealed",
          content: { type: "text/plain", data: "not applied" },
        },
      },
      23,
    ),
  );
  assert.deepEqual(decodeResponses(reused), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "invalid-operation-1",
      context_id: contextId,
      body: { code: "operation_id_reused" },
    },
  ]);
  assert.deepEqual(endpoint.context(contextId)?.blocks, []);
});

test("an invalid Message without a valid request ID produces only a local diagnostic", () => {
  const endpoint = supportedEndpoint();
  const result = endpoint.push(
    encodeRawJson(
      '{"version":1,"kind":"capability.query","request_id":"","body":{"extra":true}}',
      24,
    ),
  );

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.layer, "message");
  assert.deepEqual(result.responseFrames, []);
  assert.deepEqual(endpoint.contexts(), []);
});

test("ending the byte stream rejects an incomplete Message, closes Contexts, and prevents later input", () => {
  const endpoint = supportedEndpoint();
  const contextId = openContext(endpoint);
  endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "block.append",
        operation_id: "1",
        context_id: contextId,
        body: {
          block_id: "thinking",
          lifecycle: "mutable",
          content: { type: "text/plain", data: "draft" },
        },
      },
      2,
    ),
  );
  const incomplete = encodeMessageFrames(
    {
      version: 1,
      kind: "block.update",
      operation_id: "2",
      context_id: contextId,
      body: {
        block_id: "thinking",
        content: { type: "text/plain", data: "x".repeat(4_000) },
      },
    },
    3,
  );
  assert.ok(incomplete.length > 1);
  assert.deepEqual(endpoint.push(incomplete[0]), emptyResult());

  const finished = endpoint.finish();

  assert.equal(finished.responseFrames.length, 0);
  assert.equal(finished.diagnostics.length, 1);
  assert.equal(finished.diagnostics[0]?.layer, "framing");
  assert.deepEqual(endpoint.context(contextId), {
    id: contextId,
    state: "closed",
    blocks: [
      {
        id: "thinking",
        lifecycle: "sealed",
        content: { type: "text/plain", data: "draft" },
      },
    ],
  });
  assert.deepEqual(endpoint.finish(), emptyResult());
  assert.throws(() => endpoint.push(incomplete[1]), ProtocolEndpointError);
});

function supportedEndpoint(): TerminalProtocolEndpoint {
  return new TerminalProtocolEndpoint({ completeBaselineSupported: true });
}

function openContext(endpoint: TerminalProtocolEndpoint): string {
  const result = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "context.open",
        request_id: "open-1",
        body: {},
      },
      1,
    ),
  );
  assert.deepEqual(result.diagnostics, []);
  const [response] = decodeResponses(result);
  assert.equal(response?.kind, "context.open.response");
  if (response?.kind !== "context.open.response" || !("context_id" in response)) {
    throw new Error("Expected a successful Context open response.");
  }
  return response.context_id;
}

function encodeInput(message: Message, frameId: number): Uint8Array {
  return concatenate(encodeMessageFrames(message, frameId));
}

function encodeRawJson(source: string, frameId: number): Uint8Array {
  const payload = Buffer.from(source, "utf8").toString("base64");
  return new TextEncoder().encode(
    `\u001B]9002;1;${frameId};0;0;${payload}\u001B\\`,
  );
}

function decodeResponses(result: EndpointResult): readonly Message[] {
  const decoder = new ProtocolStreamDecoder();
  const events = result.responseFrames.flatMap((frame) => decoder.push(frame));
  assert.ok(events.every((event) => event.type === "message"));
  return events.flatMap((event) =>
    event.type === "message" ? [event.message] : [],
  );
}

function emptyResult(): EndpointResult {
  return { responseFrames: [], diagnostics: [] };
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
