import assert from "node:assert/strict";
import test from "node:test";

import type {
  BlockAppend,
  BlockExtend,
  BlockSeal,
  BlockUpdate,
  Message,
  OperationErrorCode,
} from "../reference-codec/message.ts";
import {
  ProtocolSessionError,
  TerminalProtocolSession,
} from "./session.ts";

test("repeating a capability query returns the same response, while using its request ID to open a Context is rejected", () => {
  const session = supportedSession();
  const query: Message = {
    version: 1,
    kind: "capability.query",
    request_id: "request-1",
    body: {},
  };
  const supported = {
    version: 1,
    kind: "capability.response",
    request_id: "request-1",
    body: { outcome: "supported", optional_content_types: [] },
  };

  assert.deepEqual(session.handle(query), [supported]);
  assert.deepEqual(session.handle(query), [supported]);
  assert.deepEqual(
    session.handle({
      version: 1,
      kind: "context.open",
      request_id: "request-1",
      body: {},
    }),
    [
      {
        version: 1,
        kind: "context.open.response",
        request_id: "request-1",
        body: {
          outcome: "error",
          error: { code: "request_id_conflict" },
        },
      },
    ],
  );
  assert.deepEqual(session.contexts(), []);
});

test("a host that does not claim complete version 1 support returns unsupported", () => {
  const session = new TerminalProtocolSession({
    completeBaselineSupported: false,
  });

  assert.deepEqual(
    session.handle({
      version: 1,
      kind: "capability.query",
      request_id: "request-unsupported",
      body: {},
    }),
    [
      {
        version: 1,
        kind: "capability.response",
        request_id: "request-unsupported",
        body: { outcome: "unsupported" },
      },
    ],
  );
});

test("sending the same context.open request twice creates only one Context", () => {
  const session = supportedSession();
  const open: Message = {
    version: 1,
    kind: "context.open",
    request_id: "open-1",
    body: {},
  };
  const expected = {
    version: 1,
    kind: "context.open.response",
    request_id: "open-1",
    context_id: "context-1",
    body: { outcome: "opened" },
  };

  assert.deepEqual(session.handle(open), [expected]);
  assert.deepEqual(session.handle(open), [expected]);
  assert.deepEqual(session.contexts(), [
    { id: "context-1", state: "open", blocks: [] },
  ]);
});

test("Append creates a mutable Block, Update replaces its content, and Seal prevents later Updates", () => {
  const session = openSession();

  assert.deepEqual(session.handle(append("1", "thinking", "partial")), []);
  assert.deepEqual(session.handle(update("2", "thinking", "complete")), []);
  assert.deepEqual(session.handle(seal("3", "thinking")), []);
  assert.deepEqual(session.context("context-1"), {
    id: "context-1",
    state: "open",
    blocks: [
      {
        id: "thinking",
        lifecycle: "sealed",
        content: { type: "text/plain", data: "complete" },
      },
    ],
  });

  assertOperationError(
    session.handle(update("4", "thinking", "too late")),
    "4",
    "block_sealed",
  );
  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "complete",
  );
});

test("Extend appends each fragment only when it names the Block's latest content Operation", () => {
  const session = openSession();

  assert.deepEqual(session.handle(append("1", "thinking", "Start")), []);
  assert.deepEqual(
    session.handle(extend("2", "thinking", "1", "🙂")),
    [],
  );
  assert.deepEqual(
    session.handle(extend("3", "thinking", "2", " done")),
    [],
  );
  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "Start🙂 done",
  );
});

test("a rejected Extend breaks dependent fragments until a complete Update establishes a new base", () => {
  const session = openSession();
  session.handle(append("1", "thinking", "Start"));

  assertOperationError(
    session.handle(extend("2", "thinking", "missing", " lost")),
    "2",
    "content_state_mismatch",
  );
  assertOperationError(
    session.handle(extend("3", "thinking", "2", " dependent")),
    "3",
    "content_state_mismatch",
  );
  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "Start",
  );

  assert.deepEqual(session.handle(update("4", "thinking", "Recovered")), []);
  assert.deepEqual(
    session.handle(extend("5", "thinking", "4", " safely")),
    [],
  );
  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "Recovered safely",
  );
});

test("rejecting a prepared Extend leaves its fragment unapplied and its prior base usable", () => {
  const session = openSession();
  session.handle(append("1", "thinking", "Start"));

  const preparation = session.prepareOperation(
    extend("2", "thinking", "1", " too large"),
  );
  assert.equal(preparation.status, "prepared");
  if (preparation.status !== "prepared") {
    throw new Error("Expected Extend to be prepared.");
  }

  assertOperationError(
    preparation.reject("resource_exhausted"),
    "2",
    "resource_exhausted",
  );
  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "Start",
  );
  assert.deepEqual(
    session.handle(extend("3", "thinking", "1", " fits")),
    [],
  );
  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "Start fits",
  );
});

test("Extend rejects unknown and sealed Blocks without changing their content", () => {
  const session = openSession();

  assertOperationError(
    session.handle(extend("1", "missing", "base", " fragment")),
    "1",
    "block_not_found",
  );
  session.handle(append("2", "sealed", "done", "sealed"));
  assertOperationError(
    session.handle(extend("3", "sealed", "2", " late")),
    "3",
    "block_sealed",
  );
  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "done",
  );
});

test("preparing an Update leaves its Block unchanged until commit applies the replacement", () => {
  const session = openSession();
  session.handle(append("1", "thinking", "draft"));

  const preparation = session.prepareOperation(
    update("2", "thinking", "complete"),
  );
  assert.equal(preparation.status, "prepared");
  if (preparation.status !== "prepared") {
    throw new Error("Expected Update to be prepared.");
  }

  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "draft",
  );
  assert.deepEqual(preparation.commit(), []);
  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "complete",
  );
  assert.throws(() => preparation.commit(), ProtocolSessionError);
  assert.throws(
    () => preparation.reject("internal_error"),
    ProtocolSessionError,
  );
});

test("rejecting a prepared Update with resource_exhausted leaves its Block unchanged and consumes its Operation ID", () => {
  const session = openSession();
  session.handle(append("1", "thinking", "draft"));

  const preparation = session.prepareOperation(
    update("2", "thinking", "too large"),
  );
  assert.equal(preparation.status, "prepared");
  if (preparation.status !== "prepared") {
    throw new Error("Expected Update to be prepared.");
  }

  assertOperationError(
    preparation.reject("resource_exhausted"),
    "2",
    "resource_exhausted",
  );
  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "draft",
  );
  assertOperationError(
    session.handle(update("2", "thinking", "reuse")),
    "2",
    "operation_id_reused",
  );
  assert.throws(() => preparation.commit(), ProtocolSessionError);
  assert.throws(
    () => preparation.reject("internal_error"),
    ProtocolSessionError,
  );
  assert.deepEqual(session.handle(update("3", "thinking", "complete")), []);
});

test("while an Update is prepared, the Session rejects later Messages until the host settles it", () => {
  const session = openSession();
  session.handle(append("1", "thinking", "draft"));

  const preparation = session.prepareOperation(
    update("2", "thinking", "complete"),
  );
  assert.equal(preparation.status, "prepared");
  if (preparation.status !== "prepared") {
    throw new Error("Expected Update to be prepared.");
  }

  assert.throws(
    () => session.handle(seal("3", "thinking")),
    /while an Operation is prepared/,
  );
  assertOperationError(
    preparation.reject("internal_error"),
    "2",
    "internal_error",
  );
  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "draft",
  );
  assert.deepEqual(session.handle(seal("3", "thinking")), []);
});

test("ending the connection discards a prepared Update and closes its Context without applying it", () => {
  const session = openSession();
  session.handle(append("1", "thinking", "draft"));

  const preparation = session.prepareOperation(
    update("2", "thinking", "complete"),
  );
  assert.equal(preparation.status, "prepared");
  if (preparation.status !== "prepared") {
    throw new Error("Expected Update to be prepared.");
  }

  session.endConnection();

  assert.deepEqual(session.context("context-1"), {
    id: "context-1",
    state: "closed",
    blocks: [
      {
        id: "thinking",
        lifecycle: "sealed",
        content: { type: "text/plain", data: "draft" },
      },
    ],
  });
  assert.throws(() => preparation.commit(), ProtocolSessionError);
  assert.throws(
    () => preparation.reject("internal_error"),
    ProtocolSessionError,
  );
});

test("a failed Operation leaves Blocks unchanged and its operation ID cannot be reused", () => {
  const session = openSession();

  assertOperationError(
    session.handle(update("1", "missing", "value")),
    "1",
    "block_not_found",
  );
  assertOperationError(
    session.handle(append("1", "first", "value")),
    "1",
    "operation_id_reused",
  );
  assert.deepEqual(session.context("context-1")?.blocks, []);

  assert.deepEqual(session.handle(append("2", "first", "original")), []);
  assertOperationError(
    session.handle(append("3", "first", "replacement")),
    "3",
    "block_id_reused",
  );
  assert.equal(
    session.context("context-1")?.blocks[0]?.content.data,
    "original",
  );
});

test("Seal rejects unknown and already sealed Blocks", () => {
  const session = openSession();

  assertOperationError(
    session.handle(seal("1", "missing")),
    "1",
    "block_not_found",
  );
  assert.deepEqual(
    session.handle(append("2", "static", "done", "sealed")),
    [],
  );
  assertOperationError(
    session.handle(seal("3", "static")),
    "3",
    "block_sealed",
  );
});

test("closing a Context seals mutable Blocks, retains their content, and succeeds when repeated", () => {
  const session = openSession();
  session.handle(append("1", "mutable", "draft"));
  session.handle(append("2", "static", "done", "sealed"));
  const close: Message = {
    version: 1,
    kind: "context.close",
    request_id: "close-1",
    context_id: "context-1",
    body: {},
  };
  const closed = {
    version: 1,
    kind: "context.close.response",
    request_id: "close-1",
    context_id: "context-1",
    body: { outcome: "closed" },
  };

  assert.deepEqual(session.handle(close), [closed]);
  assert.deepEqual(session.handle(close), [closed]);
  assert.deepEqual(
    session.handle({ ...close, request_id: "close-2" }),
    [{ ...closed, request_id: "close-2" }],
  );
  assert.deepEqual(session.context("context-1"), {
    id: "context-1",
    state: "closed",
    blocks: [
      {
        id: "mutable",
        lifecycle: "sealed",
        content: { type: "text/plain", data: "draft" },
      },
      {
        id: "static",
        lifecycle: "sealed",
        content: { type: "text/plain", data: "done" },
      },
    ],
  });
  assertOperationError(
    session.handle(update("3", "mutable", "late")),
    "3",
    "context_not_open",
  );
});

test("closing a Context that was never opened returns context_not_open and creates nothing", () => {
  const session = supportedSession();
  assert.deepEqual(
    session.handle({
      version: 1,
      kind: "context.close",
      request_id: "close-missing",
      context_id: "missing",
      body: {},
    }),
    [
      {
        version: 1,
        kind: "context.close.response",
        request_id: "close-missing",
        context_id: "missing",
        body: {
          outcome: "error",
          error: { code: "context_not_open" },
        },
      },
    ],
  );
  assert.deepEqual(session.contexts(), []);
});

test("one request ID cannot close two different Contexts", () => {
  const session = openSession();
  session.handle({
    version: 1,
    kind: "context.open",
    request_id: "open-2",
    body: {},
  });

  assert.equal(
    closeOutcome(session, "close-shared", "context-1"),
    "closed",
  );
  assert.deepEqual(
    session.handle({
      version: 1,
      kind: "context.close",
      request_id: "close-shared",
      context_id: "context-2",
      body: {},
    }),
    [
      {
        version: 1,
        kind: "context.close.response",
        request_id: "close-shared",
        context_id: "context-2",
        body: {
          outcome: "error",
          error: { code: "request_id_conflict" },
        },
      },
    ],
  );
  assert.equal(session.context("context-2")?.state, "open");
});

test("the same Block and Operation IDs can be used in two different Contexts", () => {
  const session = openSession();
  session.handle({
    version: 1,
    kind: "context.open",
    request_id: "open-2",
    body: {},
  });

  assert.deepEqual(session.handle(append("1", "same", "first")), []);
  assert.deepEqual(
    session.handle({
      ...append("1", "same", "second"),
      context_id: "context-2",
    }),
    [],
  );
  assert.equal(session.context("context-1")?.blocks[0]?.content.data, "first");
  assert.equal(session.context("context-2")?.blocks[0]?.content.data, "second");
});

test("the terminal-side Session rejects a capability.response Message", () => {
  const session = supportedSession();
  assert.throws(
    () =>
      session.handle({
        version: 1,
        kind: "capability.response",
        request_id: "request-1",
        body: { outcome: "unsupported" },
      }),
    ProtocolSessionError,
  );
});

test("ending the connection closes all Contexts, seals their Blocks, and rejects later Messages", () => {
  const session = openSession();
  session.handle(append("1", "first", "draft"));
  session.handle({
    version: 1,
    kind: "context.open",
    request_id: "open-2",
    body: {},
  });
  session.handle({
    ...append("1", "second", "draft"),
    context_id: "context-2",
  });

  session.endConnection();
  session.endConnection();

  assert.deepEqual(
    session.contexts().map((context) => ({
      state: context.state,
      lifecycle: context.blocks[0]?.lifecycle,
    })),
    [
      { state: "closed", lifecycle: "sealed" },
      { state: "closed", lifecycle: "sealed" },
    ],
  );
  assert.throws(
    () => session.handle(update("2", "first", "late")),
    ProtocolSessionError,
  );
});

function openSession(): TerminalProtocolSession {
  const session = supportedSession();
  session.handle({
    version: 1,
    kind: "context.open",
    request_id: "open-1",
    body: {},
  });
  return session;
}

function supportedSession(): TerminalProtocolSession {
  return new TerminalProtocolSession({ completeBaselineSupported: true });
}

function closeOutcome(
  session: TerminalProtocolSession,
  requestId: string,
  contextId: string,
): string {
  const [response] = session.handle({
    version: 1,
    kind: "context.close",
    request_id: requestId,
    context_id: contextId,
    body: {},
  });
  if (response?.kind !== "context.close.response") {
    throw new Error("Expected a Context close response.");
  }
  return response.body.outcome;
}

function append(
  operationId: string,
  blockId: string,
  data: string,
  lifecycle: "mutable" | "sealed" = "mutable",
): BlockAppend {
  return {
    version: 1,
    kind: "block.append",
    operation_id: operationId,
    context_id: "context-1",
    body: {
      block_id: blockId,
      lifecycle,
      content: { type: "text/plain", data },
    },
  };
}

function update(
  operationId: string,
  blockId: string,
  data: string,
): BlockUpdate {
  return {
    version: 1,
    kind: "block.update",
    operation_id: operationId,
    context_id: "context-1",
    body: {
      block_id: blockId,
      content: { type: "text/plain", data },
    },
  };
}

function extend(
  operationId: string,
  blockId: string,
  baseOperationId: string,
  fragment: string,
): BlockExtend {
  return {
    version: 1,
    kind: "block.extend",
    operation_id: operationId,
    context_id: "context-1",
    body: {
      block_id: blockId,
      base_operation_id: baseOperationId,
      fragment,
    },
  };
}

function seal(operationId: string, blockId: string): BlockSeal {
  return {
    version: 1,
    kind: "block.seal",
    operation_id: operationId,
    context_id: "context-1",
    body: { block_id: blockId },
  };
}

function assertOperationError(
  messages: readonly Message[],
  operationId: string,
  code: OperationErrorCode,
): void {
  assert.deepEqual(messages, [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: operationId,
      context_id: "context-1",
      body: { code },
    },
  ]);
}
