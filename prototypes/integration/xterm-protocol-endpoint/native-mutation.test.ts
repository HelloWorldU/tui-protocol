import assert from "node:assert/strict";
import test from "node:test";

import {
  append,
  bufferRows,
  closeMixedContext,
  concatenate,
  createMixedFixture,
  encodeInput,
  openAdditionalMixedContext,
  openMixedContext,
  takeResponses,
  text,
  update,
} from "./test-support.ts";

test("erasing and rewriting the unmanaged tail leaves its Context open and a later Block Update succeeds", async () => {
  const fixture = createMixedFixture();
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "draft"), 3),
      text("old tail"),
    ]),
  );

  await fixture.ingress.push(text("\r\u001B[2Knew tail"));
  await fixture.ingress.push(
    encodeInput(update(contextId, "2", "a", "complete"), 4),
  );

  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[0]?.content.data,
    "complete",
  );
  assert.deepEqual(bufferRows(fixture.terminal).slice(0, 3), [
    "complete",
    "new tail",
    "",
  ]);
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("erasing an alternate-screen row does not invalidate a normal-screen Context", async () => {
  const fixture = createMixedFixture();
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(
    encodeInput(append(contextId, "1", "a", "draft"), 3),
  );

  await fixture.ingress.push(text("\u001B[?1049halt\r\u001B[2K"));

  assert.equal(fixture.terminal.buffer.active.type, "alternate");
  assert.equal(bufferRows(fixture.terminal)[0], "");

  await fixture.ingress.push(text("\u001B[?1049l"));
  await fixture.ingress.push(
    encodeInput(update(contextId, "2", "a", "complete"), 4),
  );

  assert.equal(fixture.terminal.buffer.active.type, "normal");
  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[0]?.content.data,
    "complete",
  );
  assert.equal(bufferRows(fixture.terminal)[0], "complete");
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("erasing a managed Block line invalidates its Context before the following Update is rejected", async () => {
  const fixture = createMixedFixture();
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "draft"), 3),
      text("tail"),
    ]),
  );

  await fixture.ingress.push(
    concatenate([
      text("\u001B[1A\r\u001B[2K"),
      encodeInput(update(contextId, "2", "a", "late"), 4),
    ]),
  );

  assert.equal(fixture.endpoint.context(contextId)?.state, "invalidated");
  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[0]?.lifecycle,
    "mutable",
  );
  assert.equal(bufferRows(fixture.terminal)[0], "");
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "2",
      context_id: contextId,
      body: { code: "context_not_open" },
    },
  ]);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("erasing from inside a managed Block row preserves its prefix but invalidates the Context before Update", async () => {
  const fixture = createMixedFixture();
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(
    encodeInput(append(contextId, "1", "a", "draft"), 3),
  );

  await fixture.ingress.push(
    concatenate([
      text("\u001B[1A\u001B[4G\u001B[0K"),
      encodeInput(update(contextId, "2", "a", "late"), 4),
    ]),
  );

  assert.equal(bufferRows(fixture.terminal)[0], "dra");
  assert.equal(fixture.endpoint.context(contextId)?.state, "invalidated");
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "2",
      context_id: contextId,
      body: { code: "context_not_open" },
    },
  ]);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("erasing from the start through a managed row's cursor preserves its suffix but invalidates the Context", async () => {
  const fixture = createMixedFixture();
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(
    encodeInput(append(contextId, "1", "a", "draft"), 3),
  );

  await fixture.ingress.push(
    concatenate([
      text("\u001B[1A\u001B[4G\u001B[1K"),
      encodeInput(update(contextId, "2", "a", "late"), 4),
    ]),
  );

  assert.equal(bufferRows(fixture.terminal)[0], "    t");
  assert.equal(fixture.endpoint.context(contextId)?.state, "invalidated");
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "2",
      context_id: contextId,
      body: { code: "context_not_open" },
    },
  ]);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("clearing a viewport containing a managed Block invalidates its Context before Update", async () => {
  const fixture = createMixedFixture();
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(
    encodeInput(append(contextId, "1", "a", "draft"), 3),
  );

  await fixture.ingress.push(
    concatenate([
      text("\u001B[2J"),
      encodeInput(update(contextId, "2", "a", "late"), 4),
    ]),
  );

  assert.equal(bufferRows(fixture.terminal)[0], "");
  assert.equal(fixture.endpoint.context(contextId)?.state, "invalidated");
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "2",
      context_id: contextId,
      body: { code: "context_not_open" },
    },
  ]);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("erasing one Block retires every range in its Context while an interleaved Context can still update", async () => {
  const fixture = createMixedFixture();
  const firstContextId = await openMixedContext(fixture);
  const secondContextId = await openAdditionalMixedContext(
    fixture,
    "open-2",
    3,
  );
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(firstContextId, "1", "a", "first"), 4),
      encodeInput(append(secondContextId, "1", "b", "second"), 5),
      encodeInput(append(firstContextId, "2", "c", "sibling"), 6),
    ]),
  );

  await fixture.ingress.push(
    concatenate([
      text("\u001B[3A\r\u001B[2K"),
      encodeInput(update(secondContextId, "2", "b", "updated"), 7),
    ]),
  );

  assert.equal(fixture.endpoint.context(firstContextId)?.state, "invalidated");
  assert.equal(fixture.endpoint.context(secondContextId)?.state, "open");
  assert.equal(fixture.endpoint.range(firstContextId, "a"), undefined);
  assert.equal(fixture.endpoint.range(firstContextId, "c"), undefined);
  assert.ok(fixture.endpoint.range(secondContextId, "b"));
  assert.equal(
    fixture.endpoint.context(secondContextId)?.blocks[0]?.content.data,
    "updated",
  );
  assert.ok(bufferRows(fixture.terminal).includes("sibling"));
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("clearing scrollback invalidates only the removed Block's Context and leaves retained capacity checks usable", async () => {
  const fixture = createMixedFixture({ rows: 3, scrollback: 10 });
  const firstContextId = await openMixedContext(fixture);
  const secondContextId = await openAdditionalMixedContext(
    fixture,
    "open-2",
    3,
  );
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(firstContextId, "1", "old", "old"), 4),
      text("gap-1\r\ngap-2\r\ngap-3"),
      encodeInput(append(secondContextId, "2", "current", "current"), 5),
    ]),
  );
  const scrollbackEnd =
    fixture.terminal.buffer.active.length - fixture.terminal.rows;
  const oldRange = fixture.endpoint.range(firstContextId, "old");
  const currentRange = fixture.endpoint.range(secondContextId, "current");
  assert.ok(oldRange);
  assert.ok(currentRange);
  assert.ok(oldRange.start + oldRange.lineCount <= scrollbackEnd);
  assert.ok(currentRange.start >= scrollbackEnd);

  await fixture.ingress.push(
    concatenate([
      text("\u001B[3J"),
      encodeInput(update(firstContextId, "3", "old", "late"), 6),
      encodeInput(update(secondContextId, "4", "current", "updated"), 7),
    ]),
  );

  assert.equal(fixture.endpoint.context(firstContextId)?.state, "invalidated");
  assert.equal(fixture.endpoint.context(secondContextId)?.state, "open");
  assert.equal(fixture.endpoint.range(firstContextId, "old"), undefined);
  assert.ok(!bufferRows(fixture.terminal).includes("old"));
  assert.equal(
    fixture.endpoint.context(secondContextId)?.blocks[0]?.content.data,
    "updated",
  );
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "3",
      context_id: firstContextId,
      body: { code: "context_not_open" },
    },
  ]);

  await fixture.ingress.push(
    encodeInput(
      update(
        secondContextId,
        "5",
        "current",
        Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n"),
      ),
      8,
    ),
  );

  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "5",
      context_id: secondContextId,
      body: { code: "resource_exhausted" },
    },
  ]);
  assert.equal(
    fixture.endpoint.context(secondContextId)?.blocks[0]?.content.data,
    "updated",
  );
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("clearing scrollback retires a closed Context's removed Block without changing another open Context", async () => {
  const fixture = createMixedFixture({ rows: 3, scrollback: 10 });
  const closedContextId = await openMixedContext(fixture);
  const openContextId = await openAdditionalMixedContext(fixture, "open-2", 3);
  await fixture.ingress.push(
    encodeInput(append(closedContextId, "1", "old", "old"), 4),
  );
  await closeMixedContext(fixture, closedContextId, "close-1", 5);
  await fixture.ingress.push(
    concatenate([
      text("gap-1\r\ngap-2\r\ngap-3"),
      encodeInput(append(openContextId, "2", "current", "current"), 6),
    ]),
  );
  const oldRange = fixture.endpoint.range(closedContextId, "old");
  assert.ok(oldRange);
  assert.ok(
    oldRange.start + oldRange.lineCount <=
      fixture.terminal.buffer.active.length - fixture.terminal.rows,
  );

  await fixture.ingress.push(text("\u001B[3J"));

  assert.equal(fixture.endpoint.context(closedContextId)?.state, "closed");
  assert.equal(fixture.endpoint.context(openContextId)?.state, "open");
  assert.equal(fixture.endpoint.range(closedContextId, "old"), undefined);
  assert.ok(!bufferRows(fixture.terminal).includes("old"));
  assert.deepEqual(fixture.responseFrames, []);

  await fixture.ingress.push(
    encodeInput(
      update(
        openContextId,
        "3",
        "current",
        Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n"),
      ),
      7,
    ),
  );

  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "3",
      context_id: openContextId,
      body: { code: "resource_exhausted" },
    },
  ]);
  assert.equal(
    fixture.endpoint.context(openContextId)?.blocks[0]?.content.data,
    "current",
  );
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("a full terminal reset invalidates every Context that owns a rendered Block", async () => {
  const fixture = createMixedFixture();
  const firstContextId = await openMixedContext(fixture);
  const secondContextId = await openAdditionalMixedContext(
    fixture,
    "open-2",
    3,
  );
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(firstContextId, "1", "a", "first"), 4),
      encodeInput(append(secondContextId, "2", "b", "second"), 5),
    ]),
  );

  await fixture.ingress.push(
    concatenate([
      text("\u001Bc"),
      encodeInput(update(firstContextId, "3", "a", "late-a"), 6),
      encodeInput(update(secondContextId, "4", "b", "late-b"), 7),
    ]),
  );

  assert.equal(fixture.endpoint.context(firstContextId)?.state, "invalidated");
  assert.equal(fixture.endpoint.context(secondContextId)?.state, "invalidated");
  assert.equal(fixture.endpoint.range(firstContextId, "a"), undefined);
  assert.equal(fixture.endpoint.range(secondContextId, "b"), undefined);
  assert.ok(bufferRows(fixture.terminal).every((row) => row === ""));
  assert.equal(
    fixture.endpoint.context(firstContextId)?.blocks[0]?.lifecycle,
    "mutable",
  );
  assert.equal(
    fixture.endpoint.context(secondContextId)?.blocks[0]?.lifecycle,
    "mutable",
  );
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "3",
      context_id: firstContextId,
      body: { code: "context_not_open" },
    },
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "4",
      context_id: secondContextId,
      body: { code: "context_not_open" },
    },
  ]);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("closing a Context after its Block line is erased returns context_not_open without sealing the Block", async () => {
  const fixture = createMixedFixture();
  const contextId = await openMixedContext(fixture);
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "draft"), 3),
      text("tail"),
    ]),
  );

  await fixture.ingress.push(
    concatenate([
      text("\u001B[1A\r\u001B[2K"),
      encodeInput(
        {
          version: 1,
          kind: "context.close",
          request_id: "close-invalidated",
          context_id: contextId,
          body: {},
        },
        4,
      ),
    ]),
  );

  assert.equal(fixture.endpoint.context(contextId)?.state, "invalidated");
  assert.equal(
    fixture.endpoint.context(contextId)?.blocks[0]?.lifecycle,
    "mutable",
  );
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "context.close.response",
      request_id: "close-invalidated",
      context_id: contextId,
      body: {
        outcome: "error",
        error: { code: "context_not_open" },
      },
    },
  ]);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});
