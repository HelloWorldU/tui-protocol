import assert from "node:assert/strict";
import test from "node:test";

import headless from "@xterm/headless";

import type { Operation } from "../block-model/model.ts";
import { PrivateCoreBlockHistory } from "./private-core-history.ts";

const { Terminal } = headless;

test("adjacent Blocks without a trailing newline render with exactly one line boundary", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 20,
    rows: 3,
    scrollback: 100,
  });
  const history = new PrivateCoreBlockHistory(xterm);
  try {
    await history.apply(append("first", "alpha"));
    await history.apply(append("second", "bravo"));

    assert.deepEqual(history.range("first"), { start: 0, lineCount: 1 });
    assert.deepEqual(history.range("second"), { start: 1, lineCount: 1 });
    assert.deepEqual(bufferRows(xterm), ["alpha", "bravo", ""]);
  } finally {
    history.dispose();
    xterm.dispose();
  }
});

test("a trailing newline in the first Block does not add a blank row before the next Block", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 20,
    rows: 3,
    scrollback: 100,
  });
  const history = new PrivateCoreBlockHistory(xterm);
  try {
    await history.apply(append("first", "alpha\n"));
    await history.apply(append("second", "bravo"));

    assert.equal(
      history.blocks().find((block) => block.id === "first")?.content,
      "alpha\n",
    );
    assert.deepEqual(history.range("first"), { start: 0, lineCount: 1 });
    assert.deepEqual(history.range("second"), { start: 1, lineCount: 1 });
    assert.deepEqual(bufferRows(xterm), ["alpha", "bravo", ""]);
  } finally {
    history.dispose();
    xterm.dispose();
  }
});

test("capacity preflight counts a trailing newline as the existing Block boundary", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 20,
    rows: 3,
    scrollback: 0,
  });
  const history = new PrivateCoreBlockHistory(xterm);
  try {
    await history.apply(append("first", "alpha", "mutable"));
    await history.apply(append("second", "bravo"));

    const operation: Operation = {
      type: "update",
      id: "first",
      content: "alpha\n",
    };
    assert.equal(history.wouldExceedCapacity(operation), false);
    await history.apply(operation);

    assert.deepEqual(history.range("first"), { start: 0, lineCount: 1 });
    assert.deepEqual(history.range("second"), { start: 1, lineCount: 1 });
    assert.deepEqual(bufferRows(xterm), ["alpha", "bravo", ""]);
  } finally {
    history.dispose();
    xterm.dispose();
  }
});

function append(
  id: string,
  content: string,
  lifecycle: "mutable" | "sealed" = "sealed",
): Operation {
  return {
    type: "append",
    block: { id, content, lifecycle },
  };
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
