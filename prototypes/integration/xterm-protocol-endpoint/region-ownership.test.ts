import assert from "node:assert/strict";
import test from "node:test";

import {
  append,
  bufferRows,
  concatenate,
  createMixedFixture,
  createRegionFixture,
  encodeInput,
  extend,
  openMixedContext,
  requiredRange,
  takeResponses,
  text,
  update,
  viewportTopText,
} from "./test-support.ts";

// The simulated application is the gated pi-stock-ui composition reduced to
// its byte shape: a chrome frame drawn contiguously at startup, then
// differential redraws that move the cursor relatively and erase with CSI K.
// Without region mode the Blocks materialize at the cursor, so the redraw's
// relative cursor-up lands inside Block rows; that is the 2026-09-28
// pi-stock-ui browser failure replayed at Node level.

test("an app redraw with cursor-up and line erase after Blocks materialize at the cursor lands on Block rows and invalidates the Context", async () => {
  const fixture = createMixedFixture({ cols: 20, rows: 6 });
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(text("editor\r\nfooter\r\nstatus: ready"));
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "user", "U: question", "sealed"), 3),
      encodeInput(append(contextId, "2", "assistant", "A", "mutable"), 4),
    ])
  );
  assert.deepEqual(bufferRows(fixture.terminal), [
    "editor",
    "footer",
    "status: ready",
    "U: question",
    "A",
    "",
  ]);

  await fixture.ingress.push(
    concatenate([
      text("[1A\r[2Kfooter!"),
      encodeInput(extend(contextId, "3", "assistant", "2", " is working"), 5),
    ])
  );

  assert.equal(fixture.endpoint.context(contextId)?.state, "invalidated");
  assert.deepEqual(bufferRows(fixture.terminal), [
    "editor",
    "footer",
    "status: ready",
    "U: question",
    "footer!",
    "",
  ]);
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "3",
      context_id: contextId,
      body: { code: "context_not_open" },
    },
  ]);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("with region ownership the same app redraw after the same Blocks stays inside the chrome rows and leaves the Context open", async () => {
  const fixture = createRegionFixture({ cols: 20, rows: 6 });
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(text("editor\r\nfooter\r\nstatus: ready"));
  assert.equal(fixture.region.topRow(), 0);
  assert.equal(fixture.region.bottomRow(), 2);
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "user", "U: question", "sealed"), 3),
      encodeInput(append(contextId, "2", "assistant", "A", "mutable"), 4),
    ])
  );
  assert.deepEqual(bufferRows(fixture.terminal), [
    "U: question",
    "A",
    "editor",
    "footer",
    "status: ready",
    "",
    "",
    "",
  ]);
  assert.equal(fixture.region.topRow(), 2);
  assert.equal(fixture.region.bottomRow(), 4);

  await fixture.ingress.push(
    concatenate([
      text("[1A\r[2Kfooter!"),
      encodeInput(extend(contextId, "3", "assistant", "2", " is working"), 5),
    ])
  );

  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[1]?.content.data,
    "A is working",
  );
  assert.deepEqual(bufferRows(fixture.terminal), [
    "U: question",
    "A is working",
    "editor",
    "footer!",
    "status: ready",
    "",
    "",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "user"), {
    start: 0,
    lineCount: 1,
  });
  assert.deepEqual(fixture.endpoint.range(contextId, "assistant"), {
    start: 1,
    lineCount: 1,
  });
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("Block growth above the app region pushes the chrome down intact and the app's relative cursor math still lands on its own rows", async () => {
  const fixture = createRegionFixture({ cols: 20, rows: 6 });
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(text("editor\r\nfooter\r\nstatus: ready"));
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "user", "U: question", "sealed"), 3),
      encodeInput(append(contextId, "2", "assistant", "A", "mutable"), 4),
    ])
  );

  await fixture.ingress.push(
    encodeInput(extend(contextId, "3", "assistant", "2", "\nworking\non it"), 5),
  );

  assert.deepEqual(bufferRows(fixture.terminal), [
    "U: question",
    "A",
    "working",
    "on it",
    "editor",
    "footer",
    "status: ready",
    "",
    "",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "assistant"), {
    start: 1,
    lineCount: 3,
  });
  assert.equal(fixture.region.topRow(), 4);
  assert.equal(fixture.region.bottomRow(), 6);

  await fixture.ingress.push(text("[1A\r[2Kfooter!"));

  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.deepEqual(bufferRows(fixture.terminal), [
    "U: question",
    "A",
    "working",
    "on it",
    "editor",
    "footer!",
    "status: ready",
    "",
    "",
    "",
  ]);
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("an app erase-and-rewrite of every chrome row inside the app region never invalidates the Context", async () => {
  const fixture = createRegionFixture({ cols: 20, rows: 6 });
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(text("editor\r\nfooter\r\nstatus: ready"));
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "user", "U: question", "sealed"), 3),
      encodeInput(append(contextId, "2", "assistant", "A", "mutable"), 4),
    ])
  );

  await fixture.ingress.push(
    concatenate([
      text("[2A\r[2Keditor2\r\n[2Kfooter2\r\n[2Kstatus2"),
      encodeInput(extend(contextId, "3", "assistant", "2", " is working"), 5),
    ])
  );

  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[1]?.content.data,
    "A is working",
  );
  assert.deepEqual(bufferRows(fixture.terminal), [
    "U: question",
    "A is working",
    "editor2",
    "footer2",
    "status2",
    "",
    "",
    "",
  ]);
  assert.equal(fixture.region.topRow(), 2);
  assert.equal(fixture.region.bottomRow(), 4);
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("an erase that reaches above the chrome into Block rows still invalidates the Context in region mode", async () => {
  const fixture = createRegionFixture({ cols: 20, rows: 6 });
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(text("editor\r\nfooter\r\nstatus: ready"));
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "user", "U: question", "sealed"), 3),
      encodeInput(append(contextId, "2", "assistant", "A", "mutable"), 4),
    ])
  );

  await fixture.ingress.push(
    concatenate([
      text("[3A\r[2K"),
      encodeInput(extend(contextId, "3", "assistant", "2", " is working"), 5),
    ])
  );

  assert.equal(fixture.endpoint.context(contextId)?.state, "invalidated");
  assert.equal(bufferRows(fixture.terminal)[1], "");
  assert.equal(bufferRows(fixture.terminal)[0], "U: question");
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "3",
      context_id: contextId,
      body: { code: "context_not_open" },
    },
  ]);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("a shrinking Block relocates the app region upward and the app's cursor math still lands on its own rows", async () => {
  const fixture = createRegionFixture({ cols: 20, rows: 6 });
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(text("editor\r\nfooter\r\nstatus: ready"));
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "user", "U: question", "sealed"), 3),
      encodeInput(
        append(contextId, "2", "assistant", "A\nworking\non it", "mutable"),
        4,
      ),
    ])
  );
  assert.deepEqual(bufferRows(fixture.terminal), [
    "U: question",
    "A",
    "working",
    "on it",
    "editor",
    "footer",
    "status: ready",
    "",
    "",
    "",
  ]);
  assert.equal(fixture.region.topRow(), 4);

  await fixture.ingress.push(
    encodeInput(update(contextId, "3", "assistant", "done"), 5),
  );

  assert.deepEqual(bufferRows(fixture.terminal), [
    "U: question",
    "done",
    "editor",
    "footer",
    "status: ready",
    "",
    "",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "assistant"), {
    start: 1,
    lineCount: 1,
  });
  assert.equal(fixture.region.topRow(), 2);
  assert.equal(fixture.region.bottomRow(), 4);

  await fixture.ingress.push(text("[1A\r[2Kfooter!"));

  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.deepEqual(bufferRows(fixture.terminal), [
    "U: question",
    "done",
    "editor",
    "footer!",
    "status: ready",
    "",
    "",
    "",
  ]);
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("resize re-wraps Blocks and reflows chrome while the reading position and later region placement stay intact", async () => {
  const fixture = createRegionFixture({ cols: 20, rows: 5 });
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(text("editor\r\nfooter\r\nstatus: ready"));
  await fixture.ingress.push(
    concatenate([
      encodeInput(
        append(contextId, "1", "user", "U: a longer question", "sealed"),
        3,
      ),
      encodeInput(append(contextId, "2", "assistant", "A", "mutable"), 4),
    ])
  );
  await fixture.ingress.push(
    encodeInput(extend(contextId, "3", "assistant", "2", "\nworking"), 5),
  );
  assert.deepEqual(bufferRows(fixture.terminal), [
    "U: a longer question",
    "A",
    "working",
    "editor",
    "footer",
    "status: ready",
    "",
    "",
  ]);

  fixture.terminal.scrollToLine(0);
  assert.equal(viewportTopText(fixture.terminal), "U: a longer question");

  fixture.terminal.resize(10, 5);
  assert.equal(viewportTopText(fixture.terminal), "U: a longe");
  assert.equal(fixture.region.topRow(), undefined);
  assert.deepEqual(requiredRange(fixture.endpoint, contextId, "user"), {
    start: 0,
    lineCount: 2,
  });

  fixture.terminal.scrollToBottom();
  const editorRow = bufferRows(fixture.terminal).indexOf("editor");
  assert.ok(editorRow > 0);
  const screenRow =
    editorRow - fixture.terminal.buffer.active.baseY + 1;
  assert.ok(screenRow >= 1 && screenRow <= fixture.terminal.rows);

  await fixture.ingress.push(
    concatenate([
      text(
        `[${screenRow};1H[2Keditor\r\n[2Kfooter\r\n[2Kstatus: ready`,
      ),
      encodeInput(extend(contextId, "4", "assistant", "3", "!"), 6),
    ])
  );

  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.equal(fixture.region.topRow(), editorRow);
  assert.ok(bufferRows(fixture.terminal).includes("working!"));
  assert.equal(bufferRows(fixture.terminal).indexOf("editor"), editorRow);

  await fixture.ingress.push(text("[2A\r[2Kfooter!"));
  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.ok(bufferRows(fixture.terminal).includes("footer!"));

  await fixture.ingress.push(
    encodeInput(append(contextId, "5", "note", "note", "sealed"), 7),
  );

  const rows = bufferRows(fixture.terminal);
  assert.equal(rows.indexOf("note"), editorRow);
  assert.equal(rows.indexOf("editor"), editorRow + 1);
  assert.deepEqual(requiredRange(fixture.endpoint, contextId, "user"), {
    start: 0,
    lineCount: 2,
  });
  assert.deepEqual(requiredRange(fixture.endpoint, contextId, "assistant"), {
    start: 2,
    lineCount: 2,
  });
  assert.deepEqual(requiredRange(fixture.endpoint, contextId, "note"), {
    start: editorRow,
    lineCount: 1,
  });
  assert.deepEqual(rows.slice(editorRow + 1, editorRow + 5), [
    "editor",
    "footer!",
    "status: re",
    "ady",
  ]);
  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("appending and growing Blocks while the user reads scrollback keeps the same row at the viewport top", async () => {
  const fixture = createRegionFixture({ cols: 20, rows: 5 });
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(text("editor\r\nfooter\r\nstatus: ready"));
  await fixture.ingress.push(
    concatenate([
      encodeInput(
        append(contextId, "1", "user", "U: a longer question", "sealed"),
        3,
      ),
      encodeInput(append(contextId, "2", "assistant", "A", "mutable"), 4),
    ])
  );
  await fixture.ingress.push(
    encodeInput(extend(contextId, "3", "assistant", "2", "\nworking"), 5),
  );

  fixture.terminal.scrollToLine(0);
  assert.equal(viewportTopText(fixture.terminal), "U: a longer question");

  await fixture.ingress.push(
    encodeInput(append(contextId, "4", "note", "note", "sealed"), 6),
  );

  assert.equal(fixture.terminal.buffer.active.viewportY, 0);
  assert.equal(viewportTopText(fixture.terminal), "U: a longer question");
  assert.deepEqual(bufferRows(fixture.terminal), [
    "U: a longer question",
    "A",
    "working",
    "note",
    "editor",
    "footer",
    "status: ready",
    "",
    "",
  ]);
  assert.equal(fixture.region.topRow(), 4);

  await fixture.ingress.push(
    encodeInput(extend(contextId, "5", "assistant", "3", "\nmore"), 7),
  );

  assert.equal(fixture.terminal.buffer.active.viewportY, 0);
  assert.equal(viewportTopText(fixture.terminal), "U: a longer question");
  assert.deepEqual(bufferRows(fixture.terminal), [
    "U: a longer question",
    "A",
    "working",
    "more",
    "note",
    "editor",
    "footer",
    "status: ready",
    "",
    "",
  ]);
  assert.deepEqual(requiredRange(fixture.endpoint, contextId, "assistant"), {
    start: 1,
    lineCount: 3,
  });
  assert.equal(fixture.region.topRow(), 5);
  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});
