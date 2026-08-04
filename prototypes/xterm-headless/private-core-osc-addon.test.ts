import assert from "node:assert/strict";
import test from "node:test";

import headless from "@xterm/headless";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";

import type { Operation } from "../block-model/model.ts";
import { encodeExperimentalOperation } from "./osc-adapter.ts";
import { PrivateCoreBlockHistory } from "./private-core-history.ts";
import { ExperimentalPrivateCoreOscAddon } from "./private-core-osc-addon.ts";

const { Terminal } = headless;

test("OSC Operations update real xterm history end to end", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 10,
    rows: 3,
    scrollback: 100,
  });
  const history = new PrivateCoreBlockHistory(xterm);
  const errors: Error[] = [];
  const addon = new ExperimentalPrivateCoreOscAddon(history, {
    onError: (error) => errors.push(error),
  });
  xterm.loadAddon(addon);

  await write(
    xterm,
    [
      append("thinking", "old", "mutable"),
      append("context", "context", "sealed"),
      append("reader", "reader-1\nreader-2\nreader-3", "sealed"),
    ]
      .map(encodeExperimentalOperation)
      .join(""),
  );
  await addon.drain();

  const initialReaderStart = history.range("reader")?.start;
  assert.equal(initialReaderStart, 2);
  xterm.scrollToLine(initialReaderStart);
  assert.equal(viewportTopText(xterm), "reader-1");

  await write(
    xterm,
    encodeExperimentalOperation({
      type: "update",
      id: "thinking",
      content: "new-one\nnew-two\nnew-three",
    }),
  );
  await addon.drain();

  const updatedReaderStart = history.range("reader")?.start;
  assert.equal(updatedReaderStart, 4);
  assert.equal(xterm.buffer.active.viewportY, updatedReaderStart);
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
  assert.deepEqual(errors, []);

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

function write(terminal: HeadlessTerminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function viewportTopText(terminal: HeadlessTerminal): string {
  return (
    terminal.buffer.active
      .getLine(terminal.buffer.active.viewportY)
      ?.translateToString(true) ?? ""
  );
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
