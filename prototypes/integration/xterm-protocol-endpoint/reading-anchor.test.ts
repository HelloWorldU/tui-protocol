import assert from "node:assert/strict";
import test from "node:test";

import { XtermProtocolEndpoint } from "./endpoint.ts";
import {
  append,
  bufferRows,
  concatenate,
  createMixedFixture,
  createTerminal,
  decodeResponses,
  emptyResult,
  encodeInput,
  extend,
  negotiateAndOpen,
  openMixedContext,
  replaceSuffix,
  requiredRange,
  text,
  update,
  viewportRows,
  viewportTopText,
} from "./test-support.ts";

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

test("growing and shrinking an earlier Block keeps the unmanaged row being read at the viewport top", async () => {
  const fixture = createMixedFixture({ rows: 3, scrollback: 100 });
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "A"), 3),
      text("read-1\r\nread-2"),
      encodeInput(append(contextId, "2", "b", "B"), 4),
    ]),
  );

  assert.deepEqual(bufferRows(fixture.terminal), [
    "A",
    "read-1",
    "read-2",
    "B",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 3,
    lineCount: 1,
  });
  fixture.terminal.scrollToLine(1);
  assert.equal(fixture.terminal.buffer.active.viewportY, 1);
  assert.notEqual(
    fixture.terminal.buffer.active.viewportY,
    fixture.terminal.buffer.active.baseY,
  );
  assert.equal(viewportTopText(fixture.terminal), "read-1");

  await fixture.ingress.push(
    encodeInput(update(contextId, "3", "a", "A1\nA2\nA3"), 5),
  );

  assert.equal(fixture.terminal.buffer.active.viewportY, 3);
  assert.notEqual(
    fixture.terminal.buffer.active.viewportY,
    fixture.terminal.buffer.active.baseY,
  );
  assert.equal(viewportTopText(fixture.terminal), "read-1");
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 5,
    lineCount: 1,
  });
  assert.deepEqual(bufferRows(fixture.terminal), [
    "A1",
    "A2",
    "A3",
    "read-1",
    "read-2",
    "B",
    "",
  ]);

  await fixture.ingress.push(
    encodeInput(update(contextId, "4", "a", "final"), 6),
  );

  assert.equal(fixture.terminal.buffer.active.viewportY, 1);
  assert.notEqual(
    fixture.terminal.buffer.active.viewportY,
    fixture.terminal.buffer.active.baseY,
  );
  assert.equal(viewportTopText(fixture.terminal), "read-1");
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 3,
    lineCount: 1,
  });
  assert.deepEqual(bufferRows(fixture.terminal), [
    "final",
    "read-1",
    "read-2",
    "B",
    "",
  ]);
  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});
