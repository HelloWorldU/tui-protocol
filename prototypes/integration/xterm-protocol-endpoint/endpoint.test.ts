import assert from "node:assert/strict";
import test from "node:test";

import headless from "@xterm/headless";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";

import {
  ProtocolStreamDecoder,
  encodeMessageFrames,
  type Message,
} from "../../reference-codec/index.ts";
import type { EndpointResult } from "../protocol-endpoint/index.ts";
import { XtermProtocolEndpoint } from "./endpoint.ts";

const { Terminal } = headless;

test("OSC Message bytes grow and shrink an earlier Block without moving the later history row being read", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  const appended = endpoint.push(
    concatenate([
      encodeInput(append(contextId, "1", "thinking", "old", "mutable"), 3),
      encodeInput(append(contextId, "2", "context", "context", "sealed"), 4),
      encodeInput(
        append(
          contextId,
          "3",
          "reader",
          "reader-1\nreader-2\nreader-3",
          "sealed",
        ),
        5,
      ),
    ]),
  );
  assert.deepEqual(appended, emptyResult());
  await endpoint.drain();

  const initialReaderStart = requiredRange(endpoint, contextId, "reader").start;
  xterm.scrollToLine(initialReaderStart);
  assert.equal(viewportTopText(xterm), "reader-1");

  assert.deepEqual(
    endpoint.push(
      encodeInput(
        update(
          contextId,
          "4",
          "thinking",
          "new-one\nnew-two\nnew-three",
        ),
        6,
      ),
    ),
    emptyResult(),
  );
  await endpoint.drain();

  const grownReaderStart = requiredRange(endpoint, contextId, "reader").start;
  assert.equal(grownReaderStart, initialReaderStart + 2);
  assert.equal(xterm.buffer.active.viewportY, grownReaderStart);
  assert.equal(viewportTopText(xterm), "reader-1");
  assert.deepEqual(bufferRows(xterm), [
    "new-one",
    "new-two",
    "new-three",
    "context",
    "reader-1",
    "reader-2",
    "reader-3",
    "",
  ]);

  assert.deepEqual(
    endpoint.push(
      encodeInput(update(contextId, "5", "thinking", "final"), 7),
    ),
    emptyResult(),
  );
  await endpoint.drain();

  assert.equal(
    requiredRange(endpoint, contextId, "reader").start,
    initialReaderStart,
  );
  assert.equal(xterm.buffer.active.viewportY, initialReaderStart);
  assert.equal(viewportTopText(xterm), "reader-1");
  assert.deepEqual(bufferRows(xterm), [
    "final",
    "context",
    "reader-1",
    "reader-2",
    "reader-3",
    "",
  ]);

  endpoint.dispose();
  xterm.dispose();
});

test("OSC Message bytes keep the xterm viewport following the tail when an earlier Block changes height", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  endpoint.push(
    concatenate([
      encodeInput(append(contextId, "1", "thinking", "old", "mutable"), 3),
      encodeInput(
        append(
          contextId,
          "2",
          "tail",
          "tail-1\ntail-2\ntail-3\ntail-4\ntail-5",
          "sealed",
        ),
        4,
      ),
    ]),
  );
  await endpoint.drain();
  assert.equal(xterm.buffer.active.viewportY, xterm.buffer.active.baseY);

  xterm.scrollToLine(0);
  assert.notEqual(xterm.buffer.active.viewportY, xterm.buffer.active.baseY);
  xterm.scrollToBottom();
  assert.equal(xterm.buffer.active.viewportY, xterm.buffer.active.baseY);

  endpoint.push(
    encodeInput(
      update(contextId, "3", "thinking", "grown-1\ngrown-2\ngrown-3"),
      5,
    ),
  );
  await endpoint.drain();

  assert.equal(xterm.buffer.active.viewportY, xterm.buffer.active.baseY);
  assert.deepEqual(viewportRows(xterm), ["tail-4", "tail-5", ""]);

  xterm.resize(6, 3);
  assert.equal(xterm.buffer.active.viewportY, xterm.buffer.active.baseY);

  endpoint.dispose();
  xterm.dispose();
});

test("resizing after OSC Append keeps the later Block being read anchored through a historical Update", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  endpoint.push(
    concatenate([
      encodeInput(append(contextId, "1", "thinking", "old", "mutable"), 3),
      encodeInput(append(contextId, "2", "context", "context", "sealed"), 4),
      encodeInput(
        append(
          contextId,
          "3",
          "reader",
          "reader-1\nreader-2\nreader-3",
          "sealed",
        ),
        5,
      ),
    ]),
  );
  await endpoint.drain();

  xterm.scrollToLine(requiredRange(endpoint, contextId, "reader").start);
  assert.equal(viewportTopText(xterm), "reader-1");

  xterm.resize(6, 3);
  const readerStartAfterResize = requiredRange(
    endpoint,
    contextId,
    "reader",
  ).start;
  assert.equal(xterm.buffer.active.viewportY, readerStartAfterResize);
  assert.equal(viewportTopText(xterm), "reader");

  endpoint.push(
    encodeInput(update(contextId, "4", "thinking", "new-a\nnew-b"), 6),
  );
  await endpoint.drain();

  assert.equal(
    requiredRange(endpoint, contextId, "reader").start,
    readerStartAfterResize + 1,
  );
  assert.equal(xterm.buffer.active.viewportY, readerStartAfterResize + 1);
  assert.equal(viewportTopText(xterm), "reader");

  endpoint.dispose();
  xterm.dispose();
});

test("a sealed-Block Update returns protocol.error bytes and leaves rendered xterm history unchanged", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  endpoint.push(
    encodeInput(append(contextId, "1", "answer", "complete", "sealed"), 3),
  );
  await endpoint.drain();
  const before = bufferRows(xterm);

  const rejected = endpoint.push(
    encodeInput(update(contextId, "2", "answer", "too late"), 4),
  );
  await endpoint.drain();

  assert.deepEqual(decodeResponses(rejected), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "2",
      context_id: contextId,
      body: { code: "block_sealed" },
    },
  ]);
  assert.deepEqual(bufferRows(xterm), before);
  assert.equal(endpoint.context(contextId)?.blocks[0]?.content.data, "complete");

  endpoint.dispose();
  xterm.dispose();
});

test("when xterm cannot grow history within its capacity, drain reports failure after the Session accepts the Update", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 10,
    rows: 3,
    scrollback: 3,
  });
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  endpoint.push(
    concatenate([
      encodeInput(append(contextId, "1", "thinking", "old", "mutable"), 3),
      encodeInput(
        append(contextId, "2", "tail", "tail-1\ntail-2\ntail-3", "sealed"),
        4,
      ),
    ]),
  );
  await endpoint.drain();
  const renderedBeforeUpdate = bufferRows(xterm);

  assert.deepEqual(
    endpoint.push(
      encodeInput(
        update(
          contextId,
          "3",
          "thinking",
          "new-1\nnew-2\nnew-3\nnew-4",
        ),
        5,
      ),
    ),
    emptyResult(),
  );

  await assert.rejects(
    endpoint.drain(),
    /does not yet handle scrollback capacity trimming/,
  );
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "new-1\nnew-2\nnew-3\nnew-4",
  );
  assert.deepEqual(bufferRows(xterm), renderedBeforeUpdate);

  endpoint.dispose();
  xterm.dispose();
});

function createTerminal(): InstanceType<typeof Terminal> {
  return new Terminal({
    allowProposedApi: true,
    cols: 10,
    rows: 3,
    scrollback: 100,
  });
}

function negotiateAndOpen(endpoint: XtermProtocolEndpoint): string {
  const capability = endpoint.push(
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
  assert.deepEqual(decodeResponses(capability), [
    {
      version: 1,
      kind: "capability.response",
      request_id: "capability-1",
      body: { outcome: "supported", optional_content_types: [] },
    },
  ]);

  const opened = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "context.open",
        request_id: "open-1",
        body: {},
      },
      2,
    ),
  );
  const [response] = decodeResponses(opened);
  assert.equal(response?.kind, "context.open.response");
  if (response?.kind !== "context.open.response" || !("context_id" in response)) {
    throw new Error("Expected a successful Context open response.");
  }
  return response.context_id;
}

function append(
  contextId: string,
  operationId: string,
  blockId: string,
  content: string,
  lifecycle: "mutable" | "sealed",
): Message {
  return {
    version: 1,
    kind: "block.append",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      lifecycle,
      content: { type: "text/plain", data: content },
    },
  };
}

function update(
  contextId: string,
  operationId: string,
  blockId: string,
  content: string,
): Message {
  return {
    version: 1,
    kind: "block.update",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      content: { type: "text/plain", data: content },
    },
  };
}

function encodeInput(message: Message, frameId: number): Uint8Array {
  return concatenate(encodeMessageFrames(message, frameId));
}

function decodeResponses(result: EndpointResult): readonly Message[] {
  const decoder = new ProtocolStreamDecoder();
  const events = result.responseFrames.flatMap((frame) => decoder.push(frame));
  assert.ok(events.every((event) => event.type === "message"));
  return events.flatMap((event) =>
    event.type === "message" ? [event.message] : [],
  );
}

function requiredRange(
  endpoint: XtermProtocolEndpoint,
  contextId: string,
  blockId: string,
): { readonly start: number; readonly lineCount: number } {
  const range = endpoint.range(contextId, blockId);
  assert.ok(range);
  return range;
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

function viewportTopText(terminal: HeadlessTerminal): string {
  return (
    terminal.buffer.active
      .getLine(terminal.buffer.active.viewportY)
      ?.translateToString(true) ?? ""
  );
}

function viewportRows(terminal: HeadlessTerminal): string[] {
  const rows: string[] = [];
  for (
    let index = terminal.buffer.active.viewportY;
    index < terminal.buffer.active.viewportY + terminal.rows;
    index += 1
  ) {
    rows.push(
      terminal.buffer.active.getLine(index)?.translateToString(true) ?? "",
    );
  }
  return rows;
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
