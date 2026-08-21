import assert from "node:assert/strict";
import test from "node:test";

import {
  ProtocolError,
  TerminalPrototype,
  type Operation,
} from "./model.ts";

test("Append creates Blocks, content Operations change mutable content, and Seal prevents later changes", () => {
  const terminal = new TerminalPrototype({ width: 20, height: 4 });

  terminal.apply(
    append("static", "This output is final.", "sealed"),
  );
  terminal.apply(append("thinking", "Searching…", "mutable"));
  terminal.apply(update("thinking", "Searching repository…"));
  terminal.apply(extend("thinking", " done"));

  assert.deepEqual(terminal.blocks(), [
    {
      id: "static",
      content: "This output is final.",
      lifecycle: "sealed",
    },
    {
      id: "thinking",
      content: "Searching repository… done",
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
    () => terminal.apply(extend("thinking", " too late")),
    "BLOCK_SEALED",
  );
  assertProtocolError(
    () => terminal.apply(replaceSuffix("thinking", 0, "too late")),
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

test("ReplaceSuffix preserves an anchor in the retained prefix and moves a removed-suffix anchor to the boundary", () => {
  const terminal = new TerminalPrototype({ width: 6, height: 3 });
  terminal.apply(append("thinking", "prefix-old-tail", "mutable"));
  terminal.apply(append("after", "later content", "sealed"));

  terminal.scrollTo({ blockId: "thinking", offset: 2 });
  terminal.apply(replaceSuffix("thinking", 6, "new"));
  assert.deepEqual(terminal.anchor(), { blockId: "thinking", offset: 2 });
  assert.equal(terminal.blocks()[0]?.content, "prefixnew");

  terminal.scrollTo({ blockId: "thinking", offset: 7 });
  terminal.apply(replaceSuffix("thinking", 6, "end"));
  assert.deepEqual(terminal.anchor(), { blockId: "thinking", offset: 6 });
  assert.equal(terminal.blocks()[0]?.content, "prefixend");

  assertProtocolError(
    () => terminal.apply(replaceSuffix("thinking", 9, "invalid")),
    "INVALID_CONTENT_BOUNDARY",
  );
});

test("updating an earlier offscreen Block does not move the viewport away from the Block being read", () => {
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

test("resizing the terminal keeps the same character position in the anchored Block visible", () => {
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

function extend(id: string, fragment: string): Operation {
  return { type: "extend", id, fragment };
}

function replaceSuffix(
  id: string,
  retain: number,
  replacement: string,
): Operation {
  return { type: "replaceSuffix", id, retain, replacement };
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
