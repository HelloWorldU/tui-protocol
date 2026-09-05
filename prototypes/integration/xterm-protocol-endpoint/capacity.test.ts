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
  takeResponses,
  text,
  update,
  viewportTopText,
  write,
} from "./test-support.ts";

test("capacity checks include the visible expansion of controls before accepting a Block", () => {
  const terminal = createTerminal({ cols: 4, rows: 3, scrollback: 0 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const context = negotiateAndOpen(endpoint);
    const result = endpoint.push(encodeInput(
      append(context, "1", "text", "\x1b\x1b", "mutable"), 3,
    ));
    assert.deepEqual(decodeResponses(result), [{
      version: 1,
      kind: "protocol.error",
      context_id: context,
      operation_id: "1",
      body: { code: "resource_exhausted" },
    }]);
    assert.deepEqual(endpoint.context(context)?.blocks, []);
    assert.deepEqual(bufferRows(terminal), ["", "", ""]);
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
});

test("a Tab beside non-ASCII text is conservatively rejected before Session or rows change", () => {
  const terminal = createTerminal({ cols: 20, rows: 3 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const context = negotiateAndOpen(endpoint);
    const result = endpoint.push(encodeInput(
      append(context, "1", "text", "界\tx", "mutable"), 3,
    ));
    assert.deepEqual(decodeResponses(result), [{
      version: 1,
      kind: "protocol.error",
      context_id: context,
      operation_id: "1",
      body: { code: "resource_exhausted" },
    }]);
    assert.deepEqual(endpoint.context(context)?.blocks, []);
    assert.deepEqual(bufferRows(terminal), ["", "", ""]);
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
});

test("when xterm cannot grow history within its capacity, the rejected Update changes nothing and a later fitting Update still renders", async () => {
  const xterm = createTerminal({
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
  const xterm = createTerminal({
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

test("an Append can trim one complete oldest Block before a later capacity-planned Update trims the next Block", async () => {
  const xterm = createTerminal({
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
      encodeInput(append(contextId, "2", "next", "next", "sealed"), 4),
      encodeInput(
        append(contextId, "3", "growing", "draft", "mutable"),
        5,
      ),
      encodeInput(
        append(
          contextId,
          "4",
          "tail",
          "tail-1\ntail-2\ntail-3\ntail-4",
          "sealed",
        ),
        6,
      ),
    ]),
  );
  await endpoint.drain();

  assert.deepEqual(
    endpoint.push(
      encodeInput(
        append(
          contextId,
          "5",
          "new-tail",
          "new-1\nnew-2\nnew-3",
          "sealed",
        ),
        7,
      ),
    ),
    emptyResult(),
  );
  await endpoint.drain();

  assert.equal(endpoint.range(contextId, "oldest"), undefined);
  assert.deepEqual(requiredRange(endpoint, contextId, "next"), {
    start: 0,
    lineCount: 1,
  });

  assert.deepEqual(
    endpoint.push(
      encodeInput(
        update(contextId, "6", "growing", "target-1\ntarget-2"),
        8,
      ),
    ),
    emptyResult(),
  );
  await endpoint.drain();

  assert.equal(endpoint.range(contextId, "next"), undefined);
  assert.deepEqual(requiredRange(endpoint, contextId, "growing"), {
    start: 0,
    lineCount: 2,
  });
  assert.equal(
    endpoint.context(contextId)?.blocks.find(
      (block) => block.id === "growing",
    )?.content.data,
    "target-1\ntarget-2",
  );
  assert.deepEqual(bufferRows(xterm), [
    "target-1",
    "target-2",
    "tail-1",
    "tail-2",
    "tail-3",
    "tail-4",
    "new-1",
    "new-2",
    "new-3",
    "",
  ]);

  endpoint.dispose();
  xterm.dispose();
});

test("an Append that would trim only part of the oldest Block is rejected before changing Session or xterm history", async () => {
  const xterm = createTerminal({
    cols: 10,
    rows: 3,
    scrollback: 7,
  });
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  assert.deepEqual(
    endpoint.push(
      concatenate([
        encodeInput(
          append(contextId, "1", "oldest", "old-1\nold-2", "sealed"),
          3,
        ),
        encodeInput(append(contextId, "2", "next", "next", "sealed"), 4),
        encodeInput(
          append(
            contextId,
            "3",
            "tail",
            "tail-1\ntail-2\ntail-3\ntail-4\ntail-5",
            "sealed",
          ),
          5,
        ),
      ]),
    ),
    emptyResult(),
  );
  await endpoint.drain();
  const before = bufferRows(xterm);

  const rejected = endpoint.push(
    encodeInput(
      append(contextId, "4", "too-large", "new-1\nnew-2", "sealed"),
      6,
    ),
  );
  assert.deepEqual(decodeResponses(rejected), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "4",
      context_id: contextId,
      body: { code: "resource_exhausted" },
    },
  ]);
  await endpoint.drain();

  assert.deepEqual(bufferRows(xterm), before);
  assert.deepEqual(requiredRange(endpoint, contextId, "oldest"), {
    start: 0,
    lineCount: 2,
  });
  assert.equal(
    endpoint.context(contextId)?.blocks.some(
      (block) => block.id === "too-large",
    ),
    false,
  );

  endpoint.dispose();
  xterm.dispose();
});

test("when two Appends are queued after ordinary output, the second is rejected before it can evict that output", async () => {
  const xterm = createTerminal({
    cols: 10,
    rows: 3,
    scrollback: 7,
  });
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);
  await write(xterm, "u1\r\nu2\r\nu3\r\nu4\r\nu5\r\nu6\r\n");

  const result = endpoint.push(
    concatenate([
      encodeInput(
        append(contextId, "1", "first", "first-1\nfirst-2", "sealed"),
        3,
      ),
      encodeInput(
        append(contextId, "2", "second", "second-1\nsecond-2", "sealed"),
        4,
      ),
    ]),
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(decodeResponses(result), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "2",
      context_id: contextId,
      body: { code: "resource_exhausted" },
    },
  ]);
  await endpoint.drain();

  assert.deepEqual(bufferRows(xterm), [
    "u1",
    "u2",
    "u3",
    "u4",
    "u5",
    "u6",
    "first-1",
    "first-2",
    "",
  ]);
  assert.deepEqual(requiredRange(endpoint, contextId, "first"), {
    start: 6,
    lineCount: 2,
  });
  assert.equal(endpoint.range(contextId, "second"), undefined);
  assert.deepEqual(
    endpoint.context(contextId)?.blocks.map((block) => block.id),
    ["first"],
  );

  endpoint.dispose();
  xterm.dispose();
});

test("when capacity trimming removes the complete Block being read, the viewport moves to the next retained Block and does not follow the tail", async () => {
  const xterm = createTerminal({
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
  const xterm = createTerminal({
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

test("when ReplaceSuffix would exceed xterm history capacity, it changes neither Session content nor rendered history and the prior base remains usable", async () => {
  const xterm = createTerminal({
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

test("growing a Block beside unmanaged rows returns resource_exhausted without changing Session content or xterm rows", async () => {
  const fixture = createMixedFixture({ rows: 3, scrollback: 2 });
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "A"), 3),
      text("gap-1\r\ngap-2"),
      encodeInput(append(contextId, "2", "b", "B"), 4),
    ]),
  );
  const rowsBeforeGrowth = bufferRows(fixture.terminal);

  await fixture.ingress.push(
    encodeInput(update(contextId, "3", "a", "A1\nA2"), 5),
  );

  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "3",
      context_id: contextId,
      body: { code: "resource_exhausted" },
    },
  ]);
  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[0]?.content.data,
    "A",
  );
  assert.deepEqual(bufferRows(fixture.terminal), rowsBeforeGrowth);

  await fixture.ingress.push(
    encodeInput(update(contextId, "4", "a", "fit"), 6),
  );

  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[0]?.content.data,
    "fit",
  );
  assert.deepEqual(bufferRows(fixture.terminal), [
    "fit",
    "gap-1",
    "gap-2",
    "B",
    "",
  ]);
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("wide-character growth beside unmanaged rows returns resource_exhausted before a smaller wide Update succeeds", async () => {
  const fixture = createMixedFixture({ cols: 4, rows: 3, scrollback: 2 });
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "A"), 3),
      text("g1\r\ng2"),
      encodeInput(append(contextId, "2", "b", "B"), 4),
    ]),
  );
  const rowsBeforeGrowth = bufferRows(fixture.terminal);

  await fixture.ingress.push(
    encodeInput(update(contextId, "3", "a", "界界界界界"), 5),
  );

  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "3",
      context_id: contextId,
      body: { code: "resource_exhausted" },
    },
  ]);
  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[0]?.content.data,
    "A",
  );
  assert.deepEqual(bufferRows(fixture.terminal), rowsBeforeGrowth);

  await fixture.ingress.push(
    encodeInput(update(contextId, "4", "a", "界界"), 6),
  );

  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[0]?.content.data,
    "界界",
  );
  assert.deepEqual(bufferRows(fixture.terminal), ["界界", "g1", "g2", "B", ""]);
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});
