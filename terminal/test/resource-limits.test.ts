import assert from "node:assert/strict";
import test from "node:test";
import { TerminalProtocolSession, SessionResourceLimitError, type BlockOperation } from "../src/session.ts";
import { trialSessionLimits, type SessionResourceLimits } from "../src/resource-limits.ts";
import { PendingInputBudget } from "../src/input-budget.ts";
import { TerminalProtocolEndpoint } from "../src/endpoint.ts";
import { encodeMessageFrames, type Message } from "@tui-protocol/protocol";

function setup(overrides: Partial<SessionResourceLimits> = {}) {
  const session = new TerminalProtocolSession({ completeBaselineSupported: true, resourceLimits: { ...trialSessionLimits, ...overrides } });
  const [opened] = session.handle({ version: 1, kind: "context.open", request_id: "open", body: {} });
  assert(opened?.kind === "context.open.response" && "context_id" in opened);
  const id = opened.context_id!;
  let next = 0;
  const op = (kind: BlockOperation["kind"], body: unknown): BlockOperation => ({ version: 1, kind, context_id: id, operation_id: String(++next), body }) as BlockOperation;
  const append = (text: string, block = "b") => op("block.append", { block_id: block, lifecycle: "mutable", content: { type: "text/plain", data: text } });
  return { session, id, op, append, text: () => session.context(id)!.blocks[0]!.content.data };
}
function code(messages: readonly Message[]) { const m = messages[0]; return m?.kind === "protocol.error" ? m.body.code : undefined; }

test("repeated Extend hits the Block budget, preserves content and base, and allows a smaller subsequent edit", () => {
  const f = setup({ maxBlockCodeUnits: 5 }); const a = f.append("abc"); f.session.handle(a);
  const e = f.op("block.extend", { block_id: "b", base_operation_id: a.operation_id, fragment: "de" });
  assert.deepEqual(f.session.handle(e), []);
  const tooBig = f.op("block.extend", { block_id: "b", base_operation_id: e.operation_id, fragment: "f" });
  assert.equal(code(f.session.handle(tooBig)), "resource_exhausted"); assert.equal(f.text(), "abcde");
  assert.equal(code(f.session.handle(tooBig)), "operation_id_reused");
  assert.deepEqual(f.session.handle(f.op("block.replace_suffix", { block_id: "b", base_operation_id: e.operation_id, retain: 2, replacement: "X" })), []);
  assert.equal(f.text(), "abX");
});

test("total content and Block count include closed Contexts; shrinking Update frees content allowance but not identity", () => {
  const f = setup({ maxTotalContentCodeUnits: 6, maxBlocks: 2 }); f.session.handle(f.append("abcd"));
  assert.equal(code(f.session.handle(f.append("xyz", "second"))), "resource_exhausted");
  f.session.handle(f.op("block.update", { block_id: "b", content: { type: "text/plain", data: "a" } }));
  assert.deepEqual(f.session.handle(f.append("xyz", "second")), []);
  assert.equal(code(f.session.handle(f.append("", "third"))), "resource_exhausted");
  f.session.handle({ version: 1, kind: "context.close", request_id: "close", context_id: f.id, body: {} });
  const [opened] = f.session.handle({ version: 1, kind: "context.open", request_id: "another", body: {} });
  assert(opened?.kind === "context.open.response" && "context_id" in opened);
  const m = { ...f.append("z", "new"), context_id: opened.context_id! };
  assert.equal(code(f.session.handle(m)), "resource_exhausted");
});

test("suffix positions remain Unicode scalars while budgets count UTF-16 units, and rejected preparation consumes no content allowance", () => {
  const f = setup({ maxBlockCodeUnits: 4, maxTotalContentCodeUnits: 4 });
  const a = f.append("😀ab"); const p = f.session.prepareOperation(a);
  assert(p.status === "prepared"); p.reject("resource_exhausted");
  const b = f.append("😀ab"); assert.deepEqual(f.session.handle(b), []);
  assert.deepEqual(f.session.handle(f.op("block.replace_suffix", { block_id: "b", base_operation_id: b.operation_id, retain: 1, replacement: "中" })), []);
  assert.equal(f.text(), "😀中");
});

test("Operation identity exhaustion stops the Session instead of forgetting rejected IDs", () => {
  const f = setup({ maxOperationIds: 2 }); f.session.handle(f.append("a"));
  const rejected = f.append("x"); assert.equal(code(f.session.handle(rejected)), "block_id_reused");
  assert.throws(() => f.session.handle(f.append("y", "c")), SessionResourceLimitError);
  assert.throws(() => f.session.handle(rejected), SessionResourceLimitError); assert.equal(f.text(), "a");
});

test("cached controls still replay at the limit; a new control stops the Session without evicting prior results", () => {
  const f = setup({ maxControlResults: 1 });
  assert.equal(f.session.handle({ version: 1, kind: "context.open", request_id: "open", body: {} })[0]?.kind, "context.open.response");
  assert.throws(() => f.session.handle({ version: 1, kind: "capability.query", request_id: "new", body: {} }), SessionResourceLimitError);
});

test("Context, fingerprint and identifier limits stop before retaining another record", () => {
  const f = setup({ maxContexts: 1 });
  assert.throws(() => f.session.handle({ version: 1, kind: "context.open", request_id: "next", body: {} }), SessionResourceLimitError);
  assert.equal(f.session.contexts().length, 1);
  const g = setup({ maxIdentifierCodeUnits: 4 });
  assert.throws(() => g.session.handle(g.append("a", "too-long")), SessionResourceLimitError);
  const h = new TerminalProtocolSession({ completeBaselineSupported: true, resourceLimits: { ...trialSessionLimits, maxControlFingerprintCodeUnits: 1 } });
  assert.throws(() => h.handle({ version: 1, kind: "capability.query", request_id: "1", body: {} }), SessionResourceLimitError);
});

test("endpoint identity-budget failure rejects further bytes and EOF rather than continuing after a diagnostic", () => {
  const endpoint = new TerminalProtocolEndpoint({ completeBaselineSupported: true, resourceLimits: { ...trialSessionLimits, maxControlResults: 1 } });
  const query = (id: string) => encodeMessageFrames({ version: 1, kind: "capability.query", request_id: id, body: {} }, 1)[0]!;
  endpoint.push(query("a")); assert.throws(() => endpoint.push(query("b")), SessionResourceLimitError);
  assert.throws(() => endpoint.push(query("a")), /stopped/); assert.throws(() => endpoint.finish(), /stopped/);
});

test("pending input enforces both byte and item limits before ownership, and release is idempotent", () => {
  const budget = new PendingInputBudget(4, 2); const first = budget.acquire(4); const second = budget.acquire(0);
  assert.throws(() => budget.acquire(1)); assert.throws(() => budget.acquire(0));
  first(); first(); assert.deepEqual(budget.usage, { bytes: 0, items: 1 }); second();
  budget.acquire(4)(); assert.deepEqual(budget.usage, { bytes: 0, items: 0 });
});

test("malformed controls and Operations consume the same bounded replay and identity storage", () => {
  const endpoint = new TerminalProtocolEndpoint({ completeBaselineSupported: true, resourceLimits: { ...trialSessionLimits, maxControlResults: 1 } });
  const invalid = (id: string) => ({ type: "error" as const, layer: "message" as const, reason: "bad body", identity: { category: "control" as const, kind: "capability.query" as const, request_id: id, fingerprint: "invalid:body" } });
  endpoint.acceptDecoded(invalid("a")); assert.throws(() => endpoint.acceptDecoded(invalid("b")), SessionResourceLimitError);
  assert.throws(() => endpoint.finish(), /stopped/);
  const f = setup({ maxOperationIds: 1 });
  const identity = { category: "operation" as const, kind: "block.update" as const, context_id: f.id, operation_id: "bad" };
  assert.equal(code(f.session.handleInvalidMessage(identity)), "invalid_message");
  assert.equal(code(f.session.handleInvalidMessage(identity)), "operation_id_reused");
  assert.throws(() => f.session.handle(f.append("a")), SessionResourceLimitError);
  assert.throws(() => f.session.endConnection(), SessionResourceLimitError);
});

test("closed Context content remains charged and caller mutation cannot raise a constructed Session's budget", () => {
  const limits = { ...trialSessionLimits, maxTotalContentCodeUnits: 3 };
  const s = new TerminalProtocolSession({ completeBaselineSupported: true, resourceLimits: limits }); limits.maxTotalContentCodeUnits = 999;
  s.handle({ version: 1, kind: "context.open", request_id: "a", body: {} });
  s.handle({ version: 1, kind: "block.append", operation_id: "1", context_id: "context-1", body: { block_id: "b", lifecycle: "mutable", content: { type: "text/plain", data: "abc" } } });
  s.handle({ version: 1, kind: "context.close", request_id: "b", context_id: "context-1", body: {} });
  s.handle({ version: 1, kind: "context.open", request_id: "c", body: {} });
  assert.equal(code(s.handle({ version: 1, kind: "block.append", operation_id: "1", context_id: "context-2", body: { block_id: "b", lifecycle: "mutable", content: { type: "text/plain", data: "x" } } })), "resource_exhausted");
  for (const value of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => new TerminalProtocolSession({ completeBaselineSupported: true, resourceLimits: { ...trialSessionLimits, maxBlocks: value } }));
});
