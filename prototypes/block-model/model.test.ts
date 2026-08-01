import assert from "node:assert/strict";
import test from "node:test";

import {
  ProtocolError,
  TerminalPrototype,
  type Operation,
} from "./model.ts";

test("Append, Update, and Seal enforce the Block lifecycle", () => {
  const terminal = new TerminalPrototype({ width: 20, height: 4 });

  terminal.apply(
    append("static", "This output is final.", "sealed"),
  );
  terminal.apply(append("thinking", "Searching…", "mutable"));
  terminal.apply(update("thinking", "Searching repository…"));

  assert.deepEqual(terminal.blocks(), [
    {
      id: "static",
      content: "This output is final.",
      lifecycle: "sealed",
    },
    {
      id: "thinking",
      content: "Searching repository…",
      lifecycle: "mutable",
    },
  ]);

  terminal.apply(seal("thinking"));
  assert.equal(terminal.blocks()[1]?.lifecycle, "sealed");

  assertProtocolError(
    () => terminal.apply(update("thinking", "Too late")),
    "BLOCK_SEALED",
  );
  assertProtocolError(
    () => terminal.apply(update("missing", "Unknown")),
    "UNKNOWN_BLOCK",
  );
  assertProtocolError(
    () => terminal.apply(append("static", "Duplicate", "sealed")),
    "DUPLICATE_BLOCK",
  );
});

test("an offscreen mutable Block updates without moving a semantic reading anchor", () => {
  const terminal = new TerminalPrototype({ width: 12, height: 3 });

  terminal.apply(
    append("thinking", "plan\nsearch\ninspect\nfinish", "mutable"),
  );
  terminal.apply(
    append("reader", "Message B\nstays here", "sealed"),
  );
  terminal.apply(append("tail-1", "new output 1", "sealed"));
  terminal.apply(append("tail-2", "new output 2", "sealed"));
  terminal.apply(append("tail-3", "new output 3", "sealed"));

  assert.equal(terminal.isBlockFullyInScrollback("thinking"), true);
  assert.equal(terminal.isBlockFullyInScrollback("reader"), true);

  terminal.scrollTo({ blockId: "reader", offset: 0 });
  const before = terminal.viewportRows();

  terminal.apply(update("thinking", "finished"));
  assert.deepEqual(terminal.viewportRows(), before);

  terminal.apply(
    update(
      "thinking",
      "plan changed\nsearch again\ninspect more\nverify\nfinish",
    ),
  );

  const after = terminal.viewportRows();
  assert.deepEqual(after, before);
  assert.deepEqual(terminal.anchor(), { blockId: "reader", offset: 0 });
  assert.deepEqual(
    terminal.blocks().map(({ id }) => id),
    ["thinking", "reader", "tail-1", "tail-2", "tail-3"],
  );
  assert.equal(
    terminal.allRows().filter(({ blockId }) => blockId === "reader").length,
    2,
  );
});

test("terminal reflow preserves a Block-relative anchor across resize", () => {
  const terminal = new TerminalPrototype({ width: 12, height: 3 });

  terminal.apply(append("before", "content above", "sealed"));
  terminal.apply(
    append("reader", "A stable logical reading position", "sealed"),
  );
  terminal.apply(append("after", "content below", "sealed"));
  terminal.scrollTo({ blockId: "reader", offset: 9 });

  terminal.resize({ width: 8, height: 3 });

  assert.deepEqual(terminal.anchor(), { blockId: "reader", offset: 9 });
  assert.equal(terminal.viewportRows()[0]?.blockId, "reader");
  assert.equal(terminal.viewportRows()[0]?.startOffset, 8);
});

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

function assertProtocolError(
  action: () => void,
  expectedCode: ProtocolError["code"],
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}
