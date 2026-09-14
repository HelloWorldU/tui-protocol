import assert from "node:assert/strict";
import test from "node:test";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import {
  append, bufferRows, concatenate, createTerminal, decodeResponses, emptyResult,
  encodeInput, extend, negotiateAndOpen, requiredRange, update, viewportTopText,
} from "./test-support.ts";

for (const [label, replacement] of [
  ["grows", "new-1\nnew-2\nnew-3\nnew-4\nnew-5"],
  ["shrinks", "new"],
  ["keeps its height", "new-1\nnew-2\nnew-3"],
  ["becomes empty", ""],
] as const) {
  test(`Update of the Block being read ${label}, moves reading to its start, and permits a queued Extend`, async () => {
    const terminal = createTerminal();
    const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
    try {
      const context = negotiateAndOpen(endpoint);
      endpoint.push(concatenate([
        encodeInput(append(context, "1", "before", "before", "sealed"), 1),
        encodeInput(append(context, "2", "target", "old-1\nold-2\nold-3", "mutable"), 2),
        encodeInput(append(context, "3", "tail", "tail-1\ntail-2\ntail-3\ntail-4", "sealed"), 3),
      ]));
      await endpoint.drain();
      terminal.scrollToLine(2);
      assert.equal(viewportTopText(terminal), "old-2");
      assert.ok(terminal.buffer.active.viewportY < terminal.buffer.active.baseY);

      assert.deepEqual(endpoint.push(concatenate([
        encodeInput(update(context, "4", "target", replacement), 4),
        encodeInput(extend(context, "5", "target", "4", "\ncontinued"), 5),
      ])), emptyResult());
      await endpoint.drain();
      const expected = [...replacement.split("\n"), "continued"];
      assert.deepEqual(bufferRows(terminal), ["before", ...expected, "tail-1", "tail-2", "tail-3", "tail-4", ""]);
      assert.equal(terminal.buffer.active.viewportY, 1);
      assert.ok(terminal.buffer.active.viewportY < terminal.buffer.active.baseY);
      assert.equal(viewportTopText(terminal), expected[0]);
      assert.deepEqual(requiredRange(endpoint, context, "target"), { start: 1, lineCount: expected.length });
      assert.equal(requiredRange(endpoint, context, "tail").start, 1 + expected.length);
      assert.equal(endpoint.context(context)?.blocks[1]?.content.data, `${replacement}\ncontinued`);
      assert.equal(endpoint.context(context)?.state, "open");
      // The replacement's start marker must remain usable after a reflow.
      terminal.resize(6, 3);
      assert.equal(terminal.buffer.active.viewportY, requiredRange(endpoint, context, "target").start);
    } finally {
      endpoint.dispose();
      terminal.dispose();
    }
  });
}

test("Update of the Block being read can evict a complete earlier Block and keep the replacement at the viewport top", async () => {
  const terminal = createTerminal({ rows: 3, scrollback: 6 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const context = negotiateAndOpen(endpoint);
    endpoint.push(concatenate([
      encodeInput(append(context, "1", "before", "before-1\nbefore-2", "sealed"), 1),
      encodeInput(append(context, "2", "target", "old-1\nold-2\nold-3", "mutable"), 2),
      encodeInput(append(context, "3", "tail", "tail-1\ntail-2\ntail-3", "sealed"), 3),
    ]));
    await endpoint.drain();
    terminal.scrollToLine(3);
    assert.equal(viewportTopText(terminal), "old-2");
    const replacement = "new-1\nnew-2\nnew-3\nnew-4\nnew-5";
    assert.deepEqual(endpoint.push(encodeInput(update(context, "4", "target", replacement), 4)), emptyResult());
    await endpoint.drain();
    assert.equal(endpoint.range(context, "before"), undefined);
    assert.deepEqual(bufferRows(terminal), [...replacement.split("\n"), "tail-1", "tail-2", "tail-3", ""]);
    assert.equal(terminal.buffer.active.viewportY, 0);
    assert.equal(viewportTopText(terminal), "new-1");
    assert.ok(terminal.buffer.active.viewportY < terminal.buffer.active.baseY);
    assert.equal(requiredRange(endpoint, context, "tail").start, 5);
    assert.equal(endpoint.context(context)?.blocks[1]?.content.data, replacement);
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
});

test("a capacity-rejected Update of the Block being read leaves its reading position, content, and base usable", async () => {
  const terminal = createTerminal({ rows: 3, scrollback: 3 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const context = negotiateAndOpen(endpoint);
    endpoint.push(concatenate([
      encodeInput(append(context, "1", "target", "old-1\nold-2\nold-3", "mutable"), 1),
      encodeInput(append(context, "2", "tail", "tail-1\ntail-2", "sealed"), 2),
    ]));
    await endpoint.drain();
    terminal.scrollToLine(1);
    const before = bufferRows(terminal);
    const rejected = endpoint.push(encodeInput(update(context, "3", "target", "a\nb\nc\nd\ne\nf"), 3));
    assert.deepEqual(decodeResponses(rejected), [{
      version: 1, kind: "protocol.error", operation_id: "3", context_id: context,
      body: { code: "resource_exhausted" },
    }]);
    await endpoint.drain();
    assert.deepEqual(bufferRows(terminal), before);
    assert.equal(terminal.buffer.active.viewportY, 1);
    assert.equal(endpoint.context(context)?.blocks[0]?.content.data, "old-1\nold-2\nold-3");
    assert.deepEqual(endpoint.push(encodeInput(extend(context, "4", "target", "1", "!"), 4)), emptyResult());
    await endpoint.drain();
    assert.equal(viewportTopText(terminal), "old-2");
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
});

test("shrinking the Block being read clamps the viewport when its start can no longer be placed at the top", async () => {
  const terminal = createTerminal({ rows: 4 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const context = negotiateAndOpen(endpoint);
    endpoint.push(concatenate([
      encodeInput(append(context, "1", "before", "before", "sealed"), 1),
      encodeInput(append(context, "2", "target", "a\nb\nc\nd\ne\nf", "mutable"), 2),
    ]));
    await endpoint.drain();
    terminal.scrollToLine(2);
    assert.equal(viewportTopText(terminal), "b");
    assert.deepEqual(endpoint.push(encodeInput(update(context, "3", "target", ""), 3)), emptyResult());
    await endpoint.drain();
    assert.equal(terminal.buffer.active.viewportY, 0);
    assert.equal(terminal.buffer.active.baseY, 0);
    assert.deepEqual(requiredRange(endpoint, context, "target"), { start: 1, lineCount: 1 });
    assert.deepEqual(bufferRows(terminal), ["before", "", "", ""]);
    assert.equal(terminal.buffer.active.cursorY, 2);
    // Once all content fits, xterm's physical viewport is also at the tail.
    assert.deepEqual(endpoint.push(encodeInput(extend(context, "4", "target", "3", "a\nb\nc\nd\ne"), 4)), emptyResult());
    await endpoint.drain();
    assert.equal(terminal.buffer.active.viewportY, terminal.buffer.active.baseY);
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
});
