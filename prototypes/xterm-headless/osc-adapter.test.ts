import assert from "node:assert/strict";
import test from "node:test";

import headless from "@xterm/headless";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";

import {
  ProtocolError,
  TerminalPrototype,
  type Operation,
} from "../block-model/model.ts";
import {
  ExperimentalBlockOscAddon,
  ExperimentalOperationError,
  encodeExperimentalOperation,
} from "./osc-adapter.ts";

const { Terminal } = headless;

test("xterm OSC parsing applies Operations across split writes", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 12,
    rows: 3,
    scrollback: 100,
  });
  const model = new TerminalPrototype({ width: 1, height: 1 });
  const errors: Error[] = [];
  xterm.loadAddon(
    new ExperimentalBlockOscAddon(model, {
      onError: (error) => errors.push(error),
    }),
  );

  await write(xterm, "ordinary output\r\n");
  const encodedAppend = encodeExperimentalOperation(
    append("thinking", "search", "mutable"),
  );
  const splitAt = Math.floor(encodedAppend.length / 2);

  await write(xterm, encodedAppend.slice(0, splitAt));
  assert.deepEqual(model.blocks(), []);
  await write(xterm, encodedAppend.slice(splitAt));

  await write(
    xterm,
    encodeExperimentalOperation(update("thinking", "search repository")),
  );
  await write(xterm, encodeExperimentalOperation(seal("thinking")));

  assert.deepEqual(model.blocks(), [
    {
      id: "thinking",
      content: "search repository",
      lifecycle: "sealed",
    },
  ]);
  assert.deepEqual(errors, []);
  const visibleText = bufferText(xterm).replaceAll("\n", "");
  assert.equal(visibleText.includes("ordinary output"), true);
  assert.equal(visibleText.includes("search repository"), false);
  assert.equal(visibleText.includes('"type":"append"'), false);

  xterm.dispose();
});

test("the addon isolates decoding and lifecycle failures", async () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 10,
    rows: 2,
  });
  const model = new TerminalPrototype({ width: 10, height: 2 });
  const errors: Error[] = [];
  xterm.loadAddon(
    new ExperimentalBlockOscAddon(model, {
      onError: (error) => errors.push(error),
    }),
  );

  await write(xterm, "\u001B]777;not-json\u001B\\");
  await write(
    xterm,
    "\u001B]777;{\"type\":\"append\",\"block\":{\"id\":\"bad\",\"content\":\"x\",\"lifecycle\":\"open\"}}\u001B\\",
  );
  await write(
    xterm,
    encodeExperimentalOperation(append("final", "done", "sealed")),
  );
  await write(xterm, encodeExperimentalOperation(update("final", "late")));

  assert.equal(errors.length, 3);
  assert.ok(errors[0] instanceof ExperimentalOperationError);
  assert.ok(errors[1] instanceof ExperimentalOperationError);
  assert.ok(errors[2] instanceof ProtocolError);
  assert.equal((errors[2] as ProtocolError).code, "BLOCK_SEALED");
  assert.equal(model.blocks()[0]?.content, "done");

  xterm.dispose();
});

test("xterm resize events reflow the semantic model", () => {
  const xterm = new Terminal({
    allowProposedApi: true,
    cols: 12,
    rows: 3,
  });
  const model = new TerminalPrototype({ width: 1, height: 1 });
  xterm.loadAddon(
    new ExperimentalBlockOscAddon(model, {
      onError: (error) => assert.fail(error.message),
    }),
  );

  model.apply(append("reader", "A stable logical position", "sealed"));
  model.scrollTo({ blockId: "reader", offset: 9 });
  xterm.resize(8, 4);

  assert.deepEqual(model.anchor(), { blockId: "reader", offset: 9 });
  assert.equal(model.viewportRows()[0]?.startOffset, 8);

  xterm.dispose();
});

function write(terminal: HeadlessTerminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function bufferText(terminal: HeadlessTerminal): string {
  const lines: string[] = [];
  for (let index = 0; index < terminal.buffer.active.length; index += 1) {
    lines.push(
      terminal.buffer.active.getLine(index)?.translateToString(true) ?? "",
    );
  }
  return lines.join("\n");
}

function append(
  id: string,
  content: string,
  lifecycle: "mutable" | "sealed",
): Operation {
  return { type: "append", block: { id, content, lifecycle } };
}

function update(id: string, content: string): Operation {
  return { type: "update", id, content };
}

function seal(id: string): Operation {
  return { type: "seal", id };
}
