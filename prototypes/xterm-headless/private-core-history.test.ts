import assert from "node:assert/strict";
import test from "node:test";

import headless from "@xterm/headless";

import type { Operation } from "../block-model/model.ts";
import { PrivateCoreBlockHistory } from "./private-core-history.ts";

const { Terminal } = headless;

test("a private core Update replaces history and preserves a later reading position", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 10,
    rows: 3,
    scrollback: 100,
  });
  const history = new PrivateCoreBlockHistory(xterm);

  await history.apply(append("thinking", "old", "mutable"));
  await history.apply(append("context", "context", "sealed"));
  await history.apply(
    append(
      "reader",
      "reader-1\nreader-2\nreader-3",
      "sealed",
    ),
  );

  const initialReaderStart = requiredRange(history, "reader").start;
  const cursorLine = xterm.buffer.active.baseY + xterm.buffer.active.cursorY;
  const readerMarker = xterm.registerMarker(initialReaderStart - cursorLine);
  assert.ok(readerMarker);
  xterm.scrollToLine(initialReaderStart);
  assert.equal(viewportTopText(xterm), "reader-1");

  await history.apply({
    type: "update",
    id: "thinking",
    content: "new-one\nnew-two\nnew-three",
  });

  const grownReaderStart = requiredRange(history, "reader").start;
  assert.equal(grownReaderStart, initialReaderStart + 2);
  assert.equal(xterm.buffer.active.viewportY, grownReaderStart);
  assert.equal(readerMarker.line, grownReaderStart);
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

  await history.apply({ type: "update", id: "thinking", content: "final" });

  assert.equal(xterm.buffer.active.viewportY, initialReaderStart);
  assert.equal(readerMarker.line, initialReaderStart);
  assert.equal(viewportTopText(xterm), "reader-1");
  assert.deepEqual(bufferRows(xterm), [
    "final",
    "context",
    "reader-1",
    "reader-2",
    "reader-3",
    "",
  ]);

  history.dispose();
  xterm.dispose();
});

test("resizing xterm while reading history preserves Block boundaries and the reading position before a later Update", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 10,
    rows: 3,
    scrollback: 100,
  });
  const history = new PrivateCoreBlockHistory(xterm);

  await history.apply(append("thinking", "old", "mutable"));
  await history.apply(append("context", "context", "sealed"));
  await history.apply(
    append("reader", "reader-1\nreader-2\nreader-3", "sealed"),
  );

  xterm.scrollToLine(requiredRange(history, "reader").start);
  assert.equal(viewportTopText(xterm), "reader-1");

  xterm.resize(6, 3);
  assert.deepEqual(history.range("context"), { start: 1, lineCount: 2 });
  assert.deepEqual(history.range("reader"), { start: 3, lineCount: 6 });

  const readerStartAfterResize = requiredRange(history, "reader").start;
  assert.equal(xterm.buffer.active.viewportY, readerStartAfterResize);
  assert.equal(viewportTopText(xterm), "reader");

  await history.apply({
    type: "update",
    id: "thinking",
    content: "new-a\nnew-b",
  });

  const readerStartAfterUpdate = requiredRange(history, "reader").start;
  assert.equal(readerStartAfterUpdate, readerStartAfterResize + 1);
  assert.equal(xterm.buffer.active.viewportY, readerStartAfterUpdate);
  assert.equal(viewportTopText(xterm), "reader");
  assert.deepEqual(bufferRows(xterm), [
    "new-a",
    "new-b",
    "contex",
    "t",
    "reader",
    "-1",
    "reader",
    "-2",
    "reader",
    "-3",
    "",
  ]);

  history.dispose();
  xterm.dispose();
});

test("a bare CR renders two Block rows and Update removes both old rows", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 10,
    rows: 3,
    scrollback: 100,
  });
  const history = new PrivateCoreBlockHistory(xterm);

  await history.apply(append("thinking", "a\rb", "mutable"));
  assert.deepEqual(history.range("thinking"), { start: 0, lineCount: 2 });
  assert.deepEqual(bufferRows(xterm), ["a", "b", ""]);

  await history.apply({ type: "update", id: "thinking", content: "done" });

  assert.deepEqual(history.range("thinking"), { start: 0, lineCount: 1 });
  assert.deepEqual(bufferRows(xterm), ["done", ""]);

  history.dispose();
  xterm.dispose();
});

test("a Block range follows xterm's realized wide-character wrapping so Update removes every old row", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 3,
    rows: 3,
    scrollback: 100,
  });
  const history = new PrivateCoreBlockHistory(xterm);

  await history.apply(append("thinking", "界界", "mutable"));
  assert.deepEqual(history.range("thinking"), { start: 0, lineCount: 2 });

  await history.apply({ type: "update", id: "thinking", content: "x" });

  assert.deepEqual(history.range("thinking"), { start: 0, lineCount: 1 });
  assert.deepEqual(bufferRows(xterm), ["x", ""]);

  history.dispose();
  xterm.dispose();
});

test("a conservative narrow-Unicode capacity rejection does not mark a visible leading Block as trimmed", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 4,
    rows: 3,
    scrollback: 1,
  });
  const history = new PrivateCoreBlockHistory(xterm);

  await history.apply(append("old", "old", "mutable"));
  await history.apply(append("target", "t", "mutable"));
  await history.apply(append("tail", "tail", "mutable"));

  assert.equal(
    history.wouldExceedCapacity({
      type: "update",
      id: "target",
      content: "ééé",
    }),
    true,
  );
  assert.deepEqual(history.range("old"), { start: 0, lineCount: 1 });
  assert.equal(
    history.wouldExceedCapacity({
      type: "update",
      id: "old",
      content: "OLD",
    }),
    false,
  );

  await history.apply({ type: "update", id: "old", content: "OLD" });

  assert.deepEqual(bufferRows(xterm), ["OLD", "t", "tail", ""]);

  history.dispose();
  xterm.dispose();
});

function append(
  id: string,
  content: string,
  lifecycle: "mutable" | "sealed",
): Operation {
  return { type: "append", block: { id, content, lifecycle } };
}

function requiredRange(
  history: PrivateCoreBlockHistory,
  id: string,
): { readonly start: number; readonly lineCount: number } {
  const range = history.range(id);
  assert.ok(range);
  return range;
}

function viewportTopText(terminal: InstanceType<typeof Terminal>): string {
  return (
    terminal.buffer.active
      .getLine(terminal.buffer.active.viewportY)
      ?.translateToString(true) ?? ""
  );
}

function bufferRows(terminal: InstanceType<typeof Terminal>): string[] {
  const rows: string[] = [];
  for (let index = 0; index < terminal.buffer.active.length; index += 1) {
    rows.push(
      terminal.buffer.active.getLine(index)?.translateToString(true) ?? "",
    );
  }
  return rows;
}
