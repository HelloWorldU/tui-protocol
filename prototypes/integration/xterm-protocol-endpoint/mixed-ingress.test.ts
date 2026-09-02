import assert from "node:assert/strict";
import test from "node:test";

import headless from "@xterm/headless";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";

import {
  ProtocolStreamDecoder,
  encodeMessageFrames,
  type Message,
} from "../../reference-codec/index.ts";
import type { EndpointDiagnostic } from "../protocol-endpoint/index.ts";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import { XtermMixedStreamIngress } from "./mixed-ingress.ts";

const { Terminal } = headless;

test("one mixed chunk renders Block A, ordinary output, and Block B in order, and a later Update moves only the later history", async () => {
  const fixture = createFixture();
  const contextId = await openContext(fixture);

  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "A"), 3),
      text("ordinary"),
      encodeInput(append(contextId, "2", "b", "B"), 4),
    ]),
  );

  assert.deepEqual(bufferRows(fixture.terminal), [
    "A",
    "ordinary",
    "B",
    "",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "a"), {
    start: 0,
    lineCount: 1,
  });
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 2,
    lineCount: 1,
  });

  await fixture.ingress.push(
    encodeInput(update(contextId, "3", "a", "A1\nA2"), 5),
  );

  assert.deepEqual(bufferRows(fixture.terminal).slice(0, 5), [
    "A1",
    "A2",
    "ordinary",
    "B",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "a"), {
    start: 0,
    lineCount: 2,
  });
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 3,
    lineCount: 1,
  });
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("growing and shrinking an earlier Block keeps the unmanaged row being read at the viewport top", async () => {
  const fixture = createFixture({ rows: 3, scrollback: 100 });
  const contextId = await openContext(fixture);
  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "A"), 3),
      text("read-1\r\nread-2"),
      encodeInput(append(contextId, "2", "b", "B"), 4),
    ]),
  );

  assert.deepEqual(bufferRows(fixture.terminal), [
    "A",
    "read-1",
    "read-2",
    "B",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 3,
    lineCount: 1,
  });
  fixture.terminal.scrollToLine(1);
  assert.equal(fixture.terminal.buffer.active.viewportY, 1);
  assert.notEqual(
    fixture.terminal.buffer.active.viewportY,
    fixture.terminal.buffer.active.baseY,
  );
  assert.equal(viewportTopText(fixture.terminal), "read-1");

  await fixture.ingress.push(
    encodeInput(update(contextId, "3", "a", "A1\nA2\nA3"), 5),
  );

  assert.equal(fixture.terminal.buffer.active.viewportY, 3);
  assert.notEqual(
    fixture.terminal.buffer.active.viewportY,
    fixture.terminal.buffer.active.baseY,
  );
  assert.equal(viewportTopText(fixture.terminal), "read-1");
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 5,
    lineCount: 1,
  });
  assert.deepEqual(bufferRows(fixture.terminal), [
    "A1",
    "A2",
    "A3",
    "read-1",
    "read-2",
    "B",
    "",
  ]);

  await fixture.ingress.push(
    encodeInput(update(contextId, "4", "a", "final"), 6),
  );

  assert.equal(fixture.terminal.buffer.active.viewportY, 1);
  assert.notEqual(
    fixture.terminal.buffer.active.viewportY,
    fixture.terminal.buffer.active.baseY,
  );
  assert.equal(viewportTopText(fixture.terminal), "read-1");
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 3,
    lineCount: 1,
  });
  assert.deepEqual(bufferRows(fixture.terminal), [
    "final",
    "read-1",
    "read-2",
    "B",
    "",
  ]);
  assert.equal(fixture.endpoint.context(contextId)?.state, "open");
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("a second mixed-stream push cannot overtake an earlier push that is still rendering", async () => {
  const fixture = createFixture();
  const contextId = await openContext(fixture);

  const first = fixture.ingress.push(
    encodeInput(append(contextId, "1", "a", "A"), 3),
  );
  const second = fixture.ingress.push(
    concatenate([
      text("ordinary"),
      encodeInput(append(contextId, "2", "b", "B"), 4),
    ]),
  );
  await Promise.all([first, second]);

  assert.deepEqual(bufferRows(fixture.terminal), [
    "A",
    "ordinary",
    "B",
    "",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "a"), {
    start: 0,
    lineCount: 1,
  });
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 2,
    lineCount: 1,
  });
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("growing a Block beside unmanaged rows returns resource_exhausted without changing Session content or xterm rows", async () => {
  const fixture = createFixture({ rows: 3, scrollback: 2 });
  const contextId = await openContext(fixture);
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
  const fixture = createFixture({ cols: 4, rows: 3, scrollback: 2 });
  const contextId = await openContext(fixture);
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

test("erasing and rewriting the unmanaged tail leaves its Context open and a later Block Update succeeds", async () => {
  const fixture = createFixture();
  const contextId = await openContext(fixture);
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
  const fixture = createFixture();
  const contextId = await openContext(fixture);
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
  const fixture = createFixture();
  const contextId = await openContext(fixture);
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
  const fixture = createFixture();
  const contextId = await openContext(fixture);
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
  const fixture = createFixture();
  const contextId = await openContext(fixture);
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
  const fixture = createFixture();
  const contextId = await openContext(fixture);
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
  const fixture = createFixture();
  const firstContextId = await openContext(fixture);
  const secondContextId = await openAdditionalContext(
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
  const fixture = createFixture({ rows: 3, scrollback: 10 });
  const firstContextId = await openContext(fixture);
  const secondContextId = await openAdditionalContext(
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
  const fixture = createFixture({ rows: 3, scrollback: 10 });
  const closedContextId = await openContext(fixture);
  const openContextId = await openAdditionalContext(fixture, "open-2", 3);
  await fixture.ingress.push(
    encodeInput(append(closedContextId, "1", "old", "old"), 4),
  );
  await closeContext(fixture, closedContextId, "close-1", 5);
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
  const fixture = createFixture();
  const firstContextId = await openContext(fixture);
  const secondContextId = await openAdditionalContext(
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
  const fixture = createFixture();
  const contextId = await openContext(fixture);
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

interface Fixture {
  readonly terminal: InstanceType<typeof Terminal>;
  readonly endpoint: XtermProtocolEndpoint;
  readonly ingress: XtermMixedStreamIngress;
  readonly responseFrames: Uint8Array[];
  readonly diagnostics: EndpointDiagnostic[];
  dispose(): void;
}

interface FixtureOptions {
  readonly cols?: number;
  readonly rows?: number;
  readonly scrollback?: number;
}

function createFixture(options: FixtureOptions = {}): Fixture {
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: options.cols ?? 20,
    rows: options.rows ?? 5,
    scrollback: options.scrollback ?? 100,
  });
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true,
  });
  const responseFrames: Uint8Array[] = [];
  const diagnostics: EndpointDiagnostic[] = [];
  const ingress = new XtermMixedStreamIngress(terminal, endpoint, {
    onResponseFrame: (frame) => responseFrames.push(frame),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return {
    terminal,
    endpoint,
    ingress,
    responseFrames,
    diagnostics,
    dispose: () => {
      ingress.dispose();
      endpoint.dispose();
      terminal.dispose();
    },
  };
}

async function openContext(fixture: Fixture): Promise<string> {
  await fixture.ingress.push(
    encodeInput(
      {
        version: 1,
        kind: "capability.query",
        request_id: "capability-1",
        body: {},
      },
      1,
    ),
  );
  assert.equal(takeResponses(fixture.responseFrames)[0]?.kind, "capability.response");

  return openAdditionalContext(fixture, "open-1", 2);
}

async function openAdditionalContext(
  fixture: Fixture,
  requestId: string,
  frameId: number,
): Promise<string> {
  await fixture.ingress.push(
    encodeInput(
      {
        version: 1,
        kind: "context.open",
        request_id: requestId,
        body: {},
      },
      frameId,
    ),
  );
  const [response] = takeResponses(fixture.responseFrames);
  if (
    response?.kind !== "context.open.response" ||
    !("context_id" in response)
  ) {
    throw new Error("Expected a successful Context open response.");
  }
  return response.context_id;
}

async function closeContext(
  fixture: Fixture,
  contextId: string,
  requestId: string,
  frameId: number,
): Promise<void> {
  await fixture.ingress.push(
    encodeInput(
      {
        version: 1,
        kind: "context.close",
        request_id: requestId,
        context_id: contextId,
        body: {},
      },
      frameId,
    ),
  );
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "context.close.response",
      request_id: requestId,
      context_id: contextId,
      body: { outcome: "closed" },
    },
  ]);
}

function append(
  contextId: string,
  operationId: string,
  blockId: string,
  data: string,
): Message {
  return {
    version: 1,
    kind: "block.append",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      lifecycle: "mutable",
      content: { type: "text/plain", data },
    },
  };
}

function update(
  contextId: string,
  operationId: string,
  blockId: string,
  data: string,
): Message {
  return {
    version: 1,
    kind: "block.update",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      content: { type: "text/plain", data },
    },
  };
}

function encodeInput(message: Message, frameId: number): Uint8Array {
  return concatenate(encodeMessageFrames(message, frameId));
}

function takeResponses(frames: Uint8Array[]): readonly Message[] {
  const decoder = new ProtocolStreamDecoder();
  const events = frames.splice(0).flatMap((frame) => decoder.push(frame));
  assert.ok(events.every((event) => event.type === "message"));
  return events.flatMap((event) =>
    event.type === "message" ? [event.message] : [],
  );
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
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

function viewportTopText(terminal: HeadlessTerminal): string {
  return (
    terminal.buffer.active
      .getLine(terminal.buffer.active.viewportY)
      ?.translateToString(true) ?? ""
  );
}
