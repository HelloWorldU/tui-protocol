import assert from "node:assert/strict";
import test from "node:test";

import headless from "@xterm/headless";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";

import {
  ProtocolStreamDecoder,
  encodeMessageFrames,
  type Message,
} from "../../reference-codec/index.ts";
import type { EndpointDiagnostic } from "../protocol-endpoint/index.ts";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import { XtermMixedStreamIngress } from "./mixed-ingress.ts";

const { Terminal } = headless;

test("one mixed chunk renders Block A, ordinary output, and Block B in order, and a later Update moves only the later history", async () => {
  const fixture = createFixture();
  const contextId = await openContext(fixture);

  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "A"), 3),
      text("ordinary"),
      encodeInput(append(contextId, "2", "b", "B"), 4),
    ]),
  );

  assert.deepEqual(bufferRows(fixture.terminal), [
    "A",
    "ordinary",
    "B",
    "",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "a"), {
    start: 0,
    lineCount: 1,
  });
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 2,
    lineCount: 1,
  });

  await fixture.ingress.push(
    encodeInput(update(contextId, "3", "a", "A1\nA2"), 5),
  );

  assert.deepEqual(bufferRows(fixture.terminal).slice(0, 5), [
    "A1",
    "A2",
    "ordinary",
    "B",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "a"), {
    start: 0,
    lineCount: 2,
  });
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 3,
    lineCount: 1,
  });
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("a second mixed-stream push cannot overtake an earlier push that is still rendering", async () => {
  const fixture = createFixture();
  const contextId = await openContext(fixture);

  const first = fixture.ingress.push(
    encodeInput(append(contextId, "1", "a", "A"), 3),
  );
  const second = fixture.ingress.push(
    concatenate([
      text("ordinary"),
      encodeInput(append(contextId, "2", "b", "B"), 4),
    ]),
  );
  await Promise.all([first, second]);

  assert.deepEqual(bufferRows(fixture.terminal), [
    "A",
    "ordinary",
    "B",
    "",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "a"), {
    start: 0,
    lineCount: 1,
  });
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 2,
    lineCount: 1,
  });
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("erasing and rewriting the unmanaged tail leaves its Context open and a later Block Update succeeds", async () => {
  const fixture = createFixture();
  const contextId = await openContext(fixture);
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "draft"), 3),
      text("old tail"),
    ]),
  );

  await fixture.ingress.push(text("\r\u001B[2Knew tail"));
  await fixture.ingress.push(
    encodeInput(update(contextId, "2", "a", "complete"), 4),
  );

  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[0]?.content.data,
    "complete",
  );
  assert.deepEqual(bufferRows(fixture.terminal).slice(0, 3), [
    "complete",
    "new tail",
    "",
  ]);
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("erasing a managed Block line invalidates its Context before the following Update is rejected", async () => {
  const fixture = createFixture();
  const contextId = await openContext(fixture);
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "draft"), 3),
      text("tail"),
    ]),
  );

  await fixture.ingress.push(
    concatenate([
      text("\u001B[1A\r\u001B[2K"),
      encodeInput(update(contextId, "2", "a", "late"), 4),
    ]),
  );

  assert.equal(fixture.endpoint.context(contextId)?.state, "invalidated");
  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[0]?.lifecycle,
    "mutable",
  );
  assert.equal(bufferRows(fixture.terminal)[0], "");
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "2",
      context_id: contextId,
      body: { code: "context_not_open" },
    },
  ]);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("erasing one Context's Block invalidates only that Context and another Context can still update", async () => {
  const fixture = createFixture();
  const firstContextId = await openContext(fixture);
  const secondContextId = await openAdditionalContext(
    fixture,
    "open-2",
    3,
  );
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(firstContextId, "1", "a", "first"), 4),
      encodeInput(append(secondContextId, "2", "b", "second"), 5),
    ]),
  );

  await fixture.ingress.push(
    concatenate([
      text("\u001B[2A\r\u001B[2K"),
      encodeInput(update(secondContextId, "3", "b", "updated"), 6),
    ]),
  );

  assert.equal(fixture.endpoint.context(firstContextId)?.state, "invalidated");
  assert.equal(fixture.endpoint.context(secondContextId)?.state, "open");
  assert.equal(
    fixture.endpoint.context(secondContextId)?.blocks[0]?.content.data,
    "updated",
  );
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("closing a Context after its Block line is erased returns context_not_open without sealing the Block", async () => {
  const fixture = createFixture();
  const contextId = await openContext(fixture);
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "draft"), 3),
      text("tail"),
    ]),
  );

  await fixture.ingress.push(
    concatenate([
      text("\u001B[1A\r\u001B[2K"),
      encodeInput(
        {
          version: 1,
          kind: "context.close",
          request_id: "close-invalidated",
          context_id: contextId,
          body: {},
        },
        4,
      ),
    ]),
  );

  assert.equal(fixture.endpoint.context(contextId)?.state, "invalidated");
  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[0]?.lifecycle,
    "mutable",
  );
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "context.close.response",
      request_id: "close-invalidated",
      context_id: contextId,
      body: {
        outcome: "error",
        error: { code: "context_not_open" },
      },
    },
  ]);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

interface Fixture {
  readonly terminal: InstanceType<typeof Terminal>;
  readonly endpoint: XtermProtocolEndpoint;
  readonly ingress: XtermMixedStreamIngress;
  readonly responseFrames: Uint8Array[];
  readonly diagnostics: EndpointDiagnostic[];
  dispose(): void;
}

function createFixture(): Fixture {
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: 20,
    rows: 5,
    scrollback: 100,
  });
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true,
  });
  const responseFrames: Uint8Array[] = [];
  const diagnostics: EndpointDiagnostic[] = [];
  const ingress = new XtermMixedStreamIngress(terminal, endpoint, {
    onResponseFrame: (frame) => responseFrames.push(frame),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return {
    terminal,
    endpoint,
    ingress,
    responseFrames,
    diagnostics,
    dispose: () => {
      ingress.dispose();
      endpoint.dispose();
      terminal.dispose();
    },
  };
}

async function openContext(fixture: Fixture): Promise<string> {
  await fixture.ingress.push(
    encodeInput(
      {
        version: 1,
        kind: "capability.query",
        request_id: "capability-1",
        body: {},
      },
      1,
    ),
  );
  assert.equal(takeResponses(fixture.responseFrames)[0]?.kind, "capability.response");

  return openAdditionalContext(fixture, "open-1", 2);
}

async function openAdditionalContext(
  fixture: Fixture,
  requestId: string,
  frameId: number,
): Promise<string> {
  await fixture.ingress.push(
    encodeInput(
      {
        version: 1,
        kind: "context.open",
        request_id: requestId,
        body: {},
      },
      frameId,
    ),
  );
  const [response] = takeResponses(fixture.responseFrames);
  if (
    response?.kind !== "context.open.response" ||
    !("context_id" in response)
  ) {
    throw new Error("Expected a successful Context open response.");
  }
  return response.context_id;
}

function append(
  contextId: string,
  operationId: string,
  blockId: string,
  data: string,
): Message {
  return {
    version: 1,
    kind: "block.append",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      lifecycle: "mutable",
      content: { type: "text/plain", data },
    },
  };
}

function update(
  contextId: string,
  operationId: string,
  blockId: string,
  data: string,
): Message {
  return {
    version: 1,
    kind: "block.update",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      content: { type: "text/plain", data },
    },
  };
}

function encodeInput(message: Message, frameId: number): Uint8Array {
  return concatenate(encodeMessageFrames(message, frameId));
}

function takeResponses(frames: Uint8Array[]): readonly Message[] {
  const decoder = new ProtocolStreamDecoder();
  const events = frames.splice(0).flatMap((frame) => decoder.push(frame));
  assert.ok(events.every((event) => event.type === "message"));
  return events.flatMap((event) =>
    event.type === "message" ? [event.message] : [],
  );
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
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

function bufferRows(terminal: HeadlessTerminal): string[] {
  const rows: string[] = [];
  for (let index = 0; index < terminal.buffer.active.length; index += 1) {
    rows.push(
      terminal.buffer.active.getLine(index)?.translateToString(true) ?? "",
    );
  }
  return rows;
}
