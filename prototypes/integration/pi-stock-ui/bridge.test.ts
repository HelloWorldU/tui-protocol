import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { TuiContext } from "@tui-protocol/sdk";
import { ProtocolTranscriptBridge } from "./bridge.ts";

interface FakeContext {
  id: string;
  ops: string[];
  closed: boolean;
}

class FakeClient {
  readonly contexts: FakeContext[] = [];
  openContext(): Promise<TuiContext> {
    const context: FakeContext = { id: `ctx-${this.contexts.length + 1}`, ops: [], closed: false };
    const writer = (kind: string) => (...args: unknown[]) => {
      context.ops.push(`${kind} ${args.map(arg => JSON.stringify(arg)).join(" ")}`);
      return String(context.ops.length);
    };
    this.contexts.push(context);
    return Promise.resolve({
      id: context.id,
      append: writer("append"), update: writer("update"), extend: writer("extend"),
      replaceSuffix: writer("replaceSuffix"), seal: writer("seal"),
      close: () => { context.closed = true; return Promise.resolve(); },
    } as unknown as TuiContext);
  }
}

class FakeSession {
  readonly listeners: ((event: AgentSessionEvent) => void)[] = [];
  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners.splice(this.listeners.indexOf(listener), 1); };
  }
  emit(event: unknown): void {
    for (const listener of [...this.listeners]) listener(event as AgentSessionEvent);
  }
}

const user = (text: string) => ({ role: "user", content: text });
const assistant = (text: string, stopReason = "stop") => ({
  role: "assistant", content: [{ type: "text", text }], stopReason,
});

function run(scripted: readonly unknown[]): FakeSession {
  const session = new FakeSession();
  queueMicrotask(() => { for (const event of scripted) session.emit(event); });
  return session;
}

const TURN_ONE = [
  { type: "agent_start" },
  { type: "message_start", message: user("first") },
  { type: "message_end", message: user("first") },
  { type: "turn_start" },
  { type: "message_start", message: assistant("") },
  { type: "message_end", message: assistant("alpha") },
  { type: "turn_end" },
  { type: "agent_end", willRetry: false },
];

test("two agent runs open and close one Context each with their own Blocks", async () => {
  const client = new FakeClient();
  const failures: Error[] = [];
  const bridge = new ProtocolTranscriptBridge({ client: client as never, onFailure: error => failures.push(error) });
  const session = new FakeSession();
  bridge.attach(session);
  for (const event of TURN_ONE) session.emit(event);
  for (const event of [
    { type: "agent_start" },
    { type: "message_start", message: user("second") },
    { type: "message_end", message: user("second") },
    { type: "turn_start" },
    { type: "message_start", message: assistant("") },
    { type: "message_end", message: assistant("beta", "stop") },
    { type: "turn_end" },
    { type: "agent_end", willRetry: false },
  ]) session.emit(event);
  await bridge.drain();
  assert.equal(bridge.turns, 2);
  assert.equal(bridge.closedContexts, 2);
  assert.equal(client.contexts.length, 2);
  assert(client.contexts.every(context => context.closed));
  assert(client.contexts[0].ops.some(op => op.includes('"User:\\nfirst"')));
  assert(client.contexts[1].ops.some(op => op.includes('"User:\\nsecond"')));
  assert(client.contexts[1].ops.some(op => op.startsWith("extend") && op.includes('"beta"')));
  assert(!client.contexts[0].ops.some(op => op.includes("beta")));
  assert.deepEqual(failures, []);
  bridge.detach();
});

test("a steered user message mid-run becomes its own sealed Block in the same Context", async () => {
  const client = new FakeClient();
  const failures: Error[] = [];
  const bridge = new ProtocolTranscriptBridge({ client: client as never, onFailure: error => failures.push(error) });
  const session = new FakeSession();
  bridge.attach(session);
  for (const event of [
    { type: "agent_start" },
    { type: "message_start", message: user("first") },
    { type: "message_end", message: user("first") },
    { type: "turn_start" },
    { type: "message_start", message: assistant("") },
    { type: "message_end", message: assistant("alpha", "stop") },
    { type: "turn_end" },
    { type: "turn_start" },
    { type: "message_start", message: user("steered while streaming") },
    { type: "message_end", message: user("steered while streaming") },
    { type: "message_start", message: assistant("") },
    { type: "message_end", message: assistant("beta", "stop") },
    { type: "turn_end" },
    { type: "agent_end", willRetry: false },
  ]) session.emit(event);
  await bridge.drain();
  assert.equal(client.contexts.length, 1);
  const ops = client.contexts[0].ops;
  assert(ops.filter(op => op.startsWith("append")).length === 4, JSON.stringify(ops));
  assert(ops.some(op => op.includes('"User:\\nsteered while streaming"')));
  assert.deepEqual(failures, []);
  bridge.detach();
});

test("an out-of-turn event fails the run and stops later protocol work", async () => {
  const client = new FakeClient();
  const failures: Error[] = [];
  const bridge = new ProtocolTranscriptBridge({ client: client as never, onFailure: error => failures.push(error) });
  const session = new FakeSession();
  bridge.attach(session);
  session.emit({ type: "message_start", message: user("orphan") });
  await assert.rejects(bridge.drain(), /outside an agent run/);
  assert.equal(failures.length, 1);
  session.emit({ type: "agent_start" });
  await assert.rejects(bridge.drain(), /outside an agent run/);
  assert.equal(client.contexts.length, 0);
  bridge.detach();
});

test("session-level events without transcript content are ignored", async () => {
  const client = new FakeClient();
  const failures: Error[] = [];
  const bridge = new ProtocolTranscriptBridge({ client: client as never, onFailure: error => failures.push(error) });
  const session = new FakeSession();
  bridge.attach(session);
  session.emit({ type: "queue_update", steering: [], followUp: [] });
  session.emit({ type: "agent_settled" });
  session.emit({ type: "session_info_changed", name: "x" });
  await bridge.drain();
  assert.equal(client.contexts.length, 0);
  assert.deepEqual(failures, []);
  bridge.detach();
});

test("a compaction event is outside the trial and fails instead of being hidden", async () => {
  const client = new FakeClient();
  const failures: Error[] = [];
  const bridge = new ProtocolTranscriptBridge({ client: client as never, onFailure: error => failures.push(error) });
  const session = new FakeSession();
  bridge.attach(session);
  session.emit({ type: "compaction_start", reason: "manual" });
  await assert.rejects(bridge.drain(), /Unsupported live Pi event/);
  assert.equal(failures.length, 1);
  bridge.detach();
});
