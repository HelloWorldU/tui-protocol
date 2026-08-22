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

test("Extend bytes grow an earlier Block without moving the later history row being read, while a stale base renders nothing", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  endpoint.push(
    concatenate([
      encodeInput(append(contextId, "1", "thinking", "first", "mutable"), 3),
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

  const readerStart = requiredRange(endpoint, contextId, "reader").start;
  xterm.scrollToLine(readerStart);
  assert.equal(viewportTopText(xterm), "reader-1");

  assert.deepEqual(
    endpoint.push(
      encodeInput(
        extend(contextId, "4", "thinking", "1", "\nsecond\nthird"),
        6,
      ),
    ),
    emptyResult(),
  );
  await endpoint.drain();

  const grownReaderStart = requiredRange(endpoint, contextId, "reader").start;
  assert.equal(grownReaderStart, readerStart + 2);
  assert.equal(xterm.buffer.active.viewportY, grownReaderStart);
  assert.equal(viewportTopText(xterm), "reader-1");
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "first\nsecond\nthird",
  );
  assert.deepEqual(bufferRows(xterm), [
    "first",
    "second",
    "third",
    "context",
    "reader-1",
    "reader-2",
    "reader-3",
    "",
  ]);

  const renderedBeforeMismatch = bufferRows(xterm);
  const mismatch = endpoint.push(
    encodeInput(extend(contextId, "5", "thinking", "1", " stale"), 7),
  );
  assert.deepEqual(decodeResponses(mismatch), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "5",
      context_id: contextId,
      body: { code: "content_state_mismatch" },
    },
  ]);
  await endpoint.drain();
  assert.deepEqual(bufferRows(xterm), renderedBeforeMismatch);

  endpoint.dispose();
  xterm.dispose();
});

test("Extend keeps a pre-existing row in its own Block at the same viewport position", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  endpoint.push(
    concatenate([
      encodeInput(
        append(
          contextId,
          "1",
          "thinking",
          "thinking-1\nthinking-2\nthinking-3\nthinking-4\nthinking-5",
          "mutable",
        ),
        3,
      ),
      encodeInput(
        append(contextId, "2", "tail", "tail-1\ntail-2\ntail-3", "sealed"),
        4,
      ),
    ]),
  );
  await endpoint.drain();

  xterm.scrollToLine(1);
  assert.equal(viewportTopText(xterm), "thinking-2");

  assert.deepEqual(
    endpoint.push(
      encodeInput(
        extend(
          contextId,
          "3",
          "thinking",
          "1",
          "\nthinking-6\nthinking-7",
        ),
        5,
      ),
    ),
    emptyResult(),
  );
  await endpoint.drain();

  assert.equal(xterm.buffer.active.viewportY, 1);
  assert.equal(viewportTopText(xterm), "thinking-2");
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "thinking-1\nthinking-2\nthinking-3\nthinking-4\nthinking-5\n" +
      "thinking-6\nthinking-7",
  );

  endpoint.dispose();
  xterm.dispose();
});

test("Append and Update bytes in one input chunk are planned in order and render the updated Block", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  const result = endpoint.push(
    concatenate([
      encodeInput(append(contextId, "1", "thinking", "draft", "mutable"), 3),
      encodeInput(
        append(
          contextId,
          "2",
          "tail",
          "tail-1\ntail-2\ntail-3",
          "sealed",
        ),
        4,
      ),
      encodeInput(update(contextId, "3", "thinking", "complete"), 5),
    ]),
  );

  assert.deepEqual(result, emptyResult());
  await endpoint.drain();
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "complete",
  );
  assert.deepEqual(bufferRows(xterm), [
    "complete",
    "tail-1",
    "tail-2",
    "tail-3",
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

test("when xterm cannot grow history within its capacity, the rejected Update changes nothing and a later fitting Update still renders", async () => {
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

  const rejected = endpoint.push(
    encodeInput(
      update(
        contextId,
        "3",
        "thinking",
        "new-1\nnew-2\nnew-3\nnew-4",
      ),
      5,
    ),
  );

  assert.deepEqual(rejected.diagnostics, []);
  assert.deepEqual(decodeResponses(rejected), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "3",
      context_id: contextId,
      body: { code: "resource_exhausted" },
    },
  ]);
  await endpoint.drain();
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "old",
  );
  assert.deepEqual(bufferRows(xterm), renderedBeforeUpdate);

  assert.deepEqual(
    endpoint.push(
      encodeInput(update(contextId, "4", "thinking", "fit"), 6),
    ),
    emptyResult(),
  );
  await endpoint.drain();
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "fit",
  );
  assert.deepEqual(bufferRows(xterm), [
    "fit",
    ...renderedBeforeUpdate.slice(1),
  ]);

  endpoint.dispose();
  xterm.dispose();
});

test("when an Update fills xterm history, one complete oldest Block is trimmed, a later row being read stays in place, and the following Extend renders", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 10,
    rows: 3,
    scrollback: 7,
  });
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  endpoint.push(
    concatenate([
      encodeInput(
        append(contextId, "1", "oldest", "old-1\nold-2", "sealed"),
        3,
      ),
      encodeInput(
        append(contextId, "2", "thinking", "draft", "mutable"),
        4,
      ),
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
      encodeInput(
        append(contextId, "4", "tail", "tail-1\ntail-2", "sealed"),
        6,
      ),
    ]),
  );
  await endpoint.drain();

  const readerStart = requiredRange(endpoint, contextId, "reader").start;
  assert.equal(readerStart, 3);
  xterm.scrollToLine(readerStart);
  assert.equal(viewportTopText(xterm), "reader-1");

  assert.deepEqual(
    endpoint.push(
      concatenate([
        encodeInput(
          update(
            contextId,
            "5",
            "thinking",
            "new-1\nnew-2\nnew-3\nnew-4",
          ),
          7,
        ),
        encodeInput(
          extend(contextId, "6", "thinking", "5", "-done"),
          8,
        ),
      ]),
    ),
    emptyResult(),
  );
  await endpoint.drain();

  assert.equal(endpoint.range(contextId, "oldest"), undefined);
  assert.equal(
    endpoint.context(contextId)?.blocks.find(
      (block) => block.id === "oldest",
    )?.content.data,
    "old-1\nold-2",
  );
  assert.equal(requiredRange(endpoint, contextId, "thinking").start, 0);
  assert.equal(requiredRange(endpoint, contextId, "reader").start, 4);
  assert.equal(xterm.buffer.active.viewportY, 4);
  assert.notEqual(xterm.buffer.active.viewportY, xterm.buffer.active.baseY);
  assert.equal(viewportTopText(xterm), "reader-1");
  assert.deepEqual(bufferRows(xterm), [
    "new-1",
    "new-2",
    "new-3",
    "new-4-done",
    "reader-1",
    "reader-2",
    "reader-3",
    "tail-1",
    "tail-2",
    "",
  ]);
  assert.equal(
    endpoint.context(contextId)?.blocks.find(
      (block) => block.id === "thinking",
    )?.content.data,
    "new-1\nnew-2\nnew-3\nnew-4-done",
  );

  endpoint.dispose();
  xterm.dispose();
});

test("when capacity trimming removes the complete Block being read, the viewport moves to the next retained Block and does not follow the tail", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 10,
    rows: 3,
    scrollback: 7,
  });
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  endpoint.push(
    concatenate([
      encodeInput(
        append(contextId, "1", "oldest", "old-1\nold-2", "sealed"),
        3,
      ),
      encodeInput(
        append(contextId, "2", "thinking", "draft", "mutable"),
        4,
      ),
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
      encodeInput(
        append(contextId, "4", "tail", "tail-1\ntail-2", "sealed"),
        6,
      ),
    ]),
  );
  await endpoint.drain();

  xterm.scrollToLine(0);
  assert.equal(viewportTopText(xterm), "old-1");
  assert.notEqual(xterm.buffer.active.viewportY, xterm.buffer.active.baseY);

  assert.deepEqual(
    endpoint.push(
      encodeInput(
        update(
          contextId,
          "5",
          "thinking",
          "new-1\nnew-2\nnew-3\nnew-4",
        ),
        7,
      ),
    ),
    emptyResult(),
  );
  await endpoint.drain();

  assert.equal(endpoint.range(contextId, "oldest"), undefined);
  assert.equal(requiredRange(endpoint, contextId, "thinking").start, 0);
  assert.equal(xterm.buffer.active.viewportY, 0);
  assert.equal(viewportTopText(xterm), "new-1");
  assert.notEqual(xterm.buffer.active.viewportY, xterm.buffer.active.baseY);
  assert.deepEqual(bufferRows(xterm), [
    "new-1",
    "new-2",
    "new-3",
    "new-4",
    "reader-1",
    "reader-2",
    "reader-3",
    "tail-1",
    "tail-2",
    "",
  ]);

  endpoint.dispose();
  xterm.dispose();
});

test("when Extend would exceed xterm history capacity, it changes neither Session nor rendered history and the prior base remains usable", async () => {
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
  const before = bufferRows(xterm);

  const rejected = endpoint.push(
    encodeInput(
      extend(
        contextId,
        "3",
        "thinking",
        "1",
        "\nnew-2\nnew-3\nnew-4",
      ),
      5,
    ),
  );
  assert.deepEqual(decodeResponses(rejected), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "3",
      context_id: contextId,
      body: { code: "resource_exhausted" },
    },
  ]);
  await endpoint.drain();
  assert.equal(endpoint.context(contextId)?.blocks[0]?.content.data, "old");
  assert.deepEqual(bufferRows(xterm), before);

  assert.deepEqual(
    endpoint.push(
      encodeInput(extend(contextId, "4", "thinking", "1", "-fit"), 6),
    ),
    emptyResult(),
  );
  await endpoint.drain();
  assert.equal(endpoint.context(contextId)?.blocks[0]?.content.data, "old-fit");
  assert.deepEqual(bufferRows(xterm), ["old-fit", ...before.slice(1)]);

  endpoint.dispose();
  xterm.dispose();
});

test("ReplaceSuffix bytes change an earlier Block without moving the later history row being read, while an invalid boundary renders nothing", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  endpoint.push(
    concatenate([
      encodeInput(
        append(contextId, "1", "thinking", "keep\nold-2\nold-3", "mutable"),
        3,
      ),
      encodeInput(
        append(
          contextId,
          "2",
          "reader",
          "reader-1\nreader-2\nreader-3",
          "sealed",
        ),
        4,
      ),
    ]),
  );
  await endpoint.drain();

  const readerStart = requiredRange(endpoint, contextId, "reader").start;
  xterm.scrollToLine(readerStart);
  assert.equal(viewportTopText(xterm), "reader-1");

  const replacement = "keep\nnew-2\nnew-3\nnew-4";
  assert.deepEqual(
    endpoint.push(
      encodeInput(
        replaceSuffix(contextId, "3", "thinking", "1", 5, "new-2\nnew-3\nnew-4"),
        5,
      ),
    ),
    emptyResult(),
  );
  await endpoint.drain();

  const movedReaderStart = requiredRange(endpoint, contextId, "reader").start;
  assert.equal(movedReaderStart, readerStart + 1);
  assert.equal(xterm.buffer.active.viewportY, movedReaderStart);
  assert.equal(viewportTopText(xterm), "reader-1");
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    replacement,
  );

  const beforeInvalidBoundary = bufferRows(xterm);
  const rejected = endpoint.push(
    encodeInput(
      replaceSuffix(
        contextId,
        "4",
        "thinking",
        "3",
        Array.from(replacement).length,
        "invalid",
      ),
      6,
    ),
  );
  assert.deepEqual(decodeResponses(rejected), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "4",
      context_id: contextId,
      body: { code: "invalid_content_boundary" },
    },
  ]);
  await endpoint.drain();
  assert.deepEqual(bufferRows(xterm), beforeInvalidBoundary);

  endpoint.dispose();
  xterm.dispose();
});

test("ReplaceSuffix keeps a retained-prefix row in place and moves a removed-suffix row to the replacement boundary", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  endpoint.push(
    concatenate([
      encodeInput(
        append(
          contextId,
          "1",
          "thinking",
          "keep-1\nkeep-2\nremove-1\nremove-2\nremove-3",
          "mutable",
        ),
        3,
      ),
      encodeInput(
        append(contextId, "2", "tail", "tail-1\ntail-2\ntail-3", "sealed"),
        4,
      ),
    ]),
  );
  await endpoint.drain();

  const retain = Array.from("keep-1\nkeep-2\n").length;
  xterm.scrollToLine(1);
  assert.equal(viewportTopText(xterm), "keep-2");
  assert.deepEqual(
    endpoint.push(
      encodeInput(
        replaceSuffix(
          contextId,
          "3",
          "thinking",
          "1",
          retain,
          "new-1\nnew-2",
        ),
        5,
      ),
    ),
    emptyResult(),
  );
  await endpoint.drain();
  assert.equal(xterm.buffer.active.viewportY, 1);
  assert.equal(viewportTopText(xterm), "keep-2");

  xterm.scrollToLine(3);
  assert.equal(viewportTopText(xterm), "new-2");
  assert.deepEqual(
    endpoint.push(
      encodeInput(
        replaceSuffix(contextId, "4", "thinking", "3", retain, "final"),
        6,
      ),
    ),
    emptyResult(),
  );
  await endpoint.drain();
  assert.equal(xterm.buffer.active.viewportY, 2);
  assert.equal(viewportTopText(xterm), "final");

  endpoint.dispose();
  xterm.dispose();
});

test("when ReplaceSuffix would exceed xterm history capacity, it changes neither Session content nor rendered history and the prior base remains usable", async () => {
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
      encodeInput(append(contextId, "1", "thinking", "old-tail", "mutable"), 3),
      encodeInput(
        append(contextId, "2", "tail", "tail-1\ntail-2\ntail-3", "sealed"),
        4,
      ),
    ]),
  );
  await endpoint.drain();
  const before = bufferRows(xterm);

  const rejected = endpoint.push(
    encodeInput(
      replaceSuffix(
        contextId,
        "3",
        "thinking",
        "1",
        3,
        "\nnew-2\nnew-3\nnew-4",
      ),
      5,
    ),
  );
  assert.deepEqual(decodeResponses(rejected), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "3",
      context_id: contextId,
      body: { code: "resource_exhausted" },
    },
  ]);
  await endpoint.drain();
  assert.equal(endpoint.context(contextId)?.blocks[0]?.content.data, "old-tail");
  assert.deepEqual(bufferRows(xterm), before);

  assert.deepEqual(
    endpoint.push(
      encodeInput(
        replaceSuffix(contextId, "4", "thinking", "1", 3, "-fit"),
        6,
      ),
    ),
    emptyResult(),
  );
  await endpoint.drain();
  assert.equal(endpoint.context(contextId)?.blocks[0]?.content.data, "old-fit");
  assert.deepEqual(bufferRows(xterm), ["old-fit", ...before.slice(1)]);

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

function extend(
  contextId: string,
  operationId: string,
  blockId: string,
  baseOperationId: string,
  fragment: string,
): Message {
  return {
    version: 1,
    kind: "block.extend",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      base_operation_id: baseOperationId,
      fragment,
    },
  };
}

function replaceSuffix(
  contextId: string,
  operationId: string,
  blockId: string,
  baseOperationId: string,
  retain: number,
  replacement: string,
): Message {
  return {
    version: 1,
    kind: "block.replace_suffix",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      base_operation_id: baseOperationId,
      retain,
      replacement,
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
