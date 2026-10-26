import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "@tui-protocol/protocol";
import { trialSessionLimits } from "../src/resource-limits.ts";
import { TerminalProtocolSession } from "../src/session.ts";

test("closed Context reclamation frees retained budgets without changing IDs, closure, or control replay", () => {
  const session = new TerminalProtocolSession({
    completeBaselineSupported: true,
    resourceLimits: {
      ...trialSessionLimits,
      maxContexts: 1,
      maxBlocks: 1,
      maxOperationIds: 1,
    },
  });
  assert.deepEqual(open(session, "open-1"), {
    version: 1,
    kind: "context.open.response",
    request_id: "open-1",
    context_id: "context-1",
    body: { outcome: "opened" },
  });
  append(session, "1", "context-1", "retained by the renderer");
  assert.deepEqual(session.reclaimClosedContext("context-1"), undefined);
  assert.deepEqual(close(session, "close-1", "context-1"), [{
    version: 1,
    kind: "context.close.response",
    request_id: "close-1",
    context_id: "context-1",
    body: { outcome: "closed" },
  }]);

  assert.deepEqual(session.reclaimClosedContext("context-1"), {
    id: "context-1",
    state: "closed",
    blocks: [{
      id: "answer",
      lifecycle: "sealed",
      content: { type: "text/plain", data: "retained by the renderer" },
    }],
  });
  assert.deepEqual(session.contexts(), []);
  assert.equal(session.context("context-1"), undefined);
  assert.deepEqual(close(session, "close-1", "context-1"), [{
    version: 1,
    kind: "context.close.response",
    request_id: "close-1",
    context_id: "context-1",
    body: { outcome: "closed" },
  }]);
  assert.deepEqual(close(session, "close-2", "context-1"), [{
    version: 1,
    kind: "context.close.response",
    request_id: "close-2",
    context_id: "context-1",
    body: { outcome: "closed" },
  }]);
  assert.deepEqual(open(session, "open-1"), {
    version: 1,
    kind: "context.open.response",
    request_id: "open-1",
    context_id: "context-1",
    body: { outcome: "opened" },
  });
  assert.equal(session.contexts().length, 0);
  assert.deepEqual(close(session, "close-unknown", "context-99")[0].body, {
    outcome: "error", error: { code: "context_not_open" },
  });
  assert.deepEqual(close(session, "close-noncanonical", "context-01")[0].body, {
    outcome: "error", error: { code: "context_not_open" },
  });
  assert.deepEqual(session.handle(update("later", "context-1")), [{
    version: 1,
    kind: "protocol.error",
    operation_id: "later",
    context_id: "context-1",
    body: { code: "context_not_open" },
  }]);

  assert.equal(open(session, "open-2").context_id, "context-2");
  append(session, "1", "context-2", "new content");
  close(session, "close-3", "context-2");
  assert.equal(session.reclaimClosedContext("context-2")?.id, "context-2");
  assert.equal(open(session, "open-3").context_id, "context-3");
  assert.deepEqual(session.contexts().map(context => context.id), ["context-3"]);
});

test("open and invalidated Contexts keep their snapshots and cannot be reclaimed", () => {
  const session = new TerminalProtocolSession({ completeBaselineSupported: true });
  assert.equal(open(session, "open-1").context_id, "context-1");
  append(session, "1", "context-1", "still owned by the Session");
  assert.equal(session.reclaimClosedContext("context-1"), undefined);
  assert.equal(session.context("context-1")?.state, "open");
  assert.equal(session.invalidateContext("context-1"), true);
  assert.equal(session.reclaimClosedContext("context-1"), undefined);
  assert.equal(session.context("context-1")?.state, "invalidated");
  assert.deepEqual(close(session, "close-1", "context-1")[0].body, {
    outcome: "error", error: { code: "context_not_open" },
  });
  assert.equal(open(session, "open-2").context_id, "context-2");
  close(session, "close-2", "context-2");
  assert.deepEqual(session.reclaimClosedContext("context-2"), {
    id: "context-2", state: "closed", blocks: [],
  });
  assert.equal(session.context("context-1")?.state, "invalidated");
});

type OpenedContextResponse = Extract<Message, { kind: "context.open.response"; context_id: string }>;

function open(session: TerminalProtocolSession, requestId: string): OpenedContextResponse {
  const response = session.handle({
    version: 1, kind: "context.open", request_id: requestId, body: {},
  })[0];
  assert.equal(response.kind, "context.open.response");
  assert("context_id" in response);
  return response as OpenedContextResponse;
}

function close(session: TerminalProtocolSession, requestId: string, contextId: string): readonly Message[] {
  return session.handle({
    version: 1, kind: "context.close", request_id: requestId, context_id: contextId, body: {},
  });
}

function append(session: TerminalProtocolSession, operationId: string, contextId: string, text: string): void {
  assert.deepEqual(session.handle({
    version: 1,
    kind: "block.append",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: "answer",
      lifecycle: "mutable",
      content: { type: "text/plain", data: text },
    },
  }), []);
}

function update(operationId: string, contextId: string): Message {
  return {
    version: 1,
    kind: "block.update",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: "answer",
      content: { type: "text/plain", data: "must not execute" },
    },
  };
}
