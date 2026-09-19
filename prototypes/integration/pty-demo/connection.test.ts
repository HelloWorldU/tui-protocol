import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { type TestContext } from "node:test";
import { WebSocket } from "ws";
import type { IPty } from "node-pty";
import { bindPtyConnection } from "./connection.ts";

function fixture(t: TestContext, throwKill = false) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  class Socket extends EventEmitter {
    readyState: number = WebSocket.OPEN;
    bufferedAmount = 0;
    sent: (string | Buffer)[] = [];
    closes: number[] = [];
    terminations = 0;
    send(value: string | Buffer) { this.sent.push(value); }
    close(code: number) { this.closes.push(code); this.readyState = WebSocket.CLOSING; }
    terminate() { this.terminations++; this.disconnect(); }
    disconnect() { this.readyState = WebSocket.CLOSED; this.emit("close"); }
  }
  const socket = new Socket();
  const events = new EventEmitter();
  let kills = 0, resumes = 0, writes = 0, releases = 0;
  const errors: unknown[] = [];
  const child = {
    onData(fn: (data: string) => void) { events.on("data", fn); return { dispose() { events.off("data", fn); } }; },
    onExit(fn: (event: { exitCode: number }) => void) { events.on("exit", fn); return { dispose() { events.off("exit", fn); } }; },
    kill() { kills++; if (throwKill) throw new Error("Injected kill failure"); },
    resume() { resumes++; }, pause() {}, write() { writes++; }, resize() {},
  };
  bindPtyConnection(socket as unknown as WebSocket, child as unknown as IPty,
    { high: 16, low: 4, stallMs: 100 }, () => releases++, error => errors.push(error));
  return { socket, events, errors, state: () => ({ kills, resumes, writes, releases }),
    reports: () => socket.sent.filter((v): v is string => typeof v === "string").map(v => JSON.parse(v)) };
}

test("missing child exit reports unconfirmed cleanup, forces socket close, and holds the slot until a late exit", t => {
  const f = fixture(t, true);
  f.events.emit("data", "a".repeat(20)); t.mock.timers.tick(100);
  const sent = f.socket.sent.length;
  f.events.emit("data", "late output"); f.socket.emit("message", Buffer.from("input"), true);
  assert.equal(f.socket.sent.length, sent); assert.equal(f.state().writes, 0);
  assert.equal(f.errors.length, 1); assert.equal(f.state().resumes, 1);
  t.mock.timers.tick(2000);
  assert.deepEqual(f.reports().filter(v => v.type === "host_error"), [{ type: "host_error", reason: "consumer_stalled", childExitObserved: false }]);
  assert.deepEqual(f.socket.closes, [1011]); t.mock.timers.tick(1000);
  assert.equal(f.socket.terminations, 1); assert.equal(f.state().releases, 0);
  f.events.emit("exit", { exitCode: 1 }); f.events.emit("exit", { exitCode: 1 });
  assert.equal(f.state().releases, 1); assert.equal(f.state().kills, 1);
  assert.equal(f.events.listenerCount("exit"), 0); assert.equal(f.events.listenerCount("data"), 0);
});

test("child exit during stall cleanup is reported once and a completed close cancels the forced-close timer", t => {
  const f = fixture(t); f.events.emit("data", "x"); t.mock.timers.tick(100);
  f.events.emit("exit", { exitCode: 1 }); f.socket.disconnect(); t.mock.timers.tick(5000);
  assert.equal(f.reports().filter(v => v.type === "host_error" && v.childExitObserved).length, 1);
  assert.equal(f.reports().filter(v => v.type === "exit").length, 0);
  assert.equal(f.socket.terminations, 0); assert.equal(f.state().releases, 1);
});

test("abrupt disconnect stops a paused child, drops later output and waits for its exit before releasing the slot", t => {
  const f = fixture(t); f.events.emit("data", "a".repeat(20));
  f.socket.disconnect(); const sent = f.socket.sent.length;
  f.events.emit("data", "late"); t.mock.timers.tick(5000);
  assert.equal(f.socket.sent.length, sent); assert.equal(f.state().kills, 1);
  assert.equal(f.state().resumes, 1); assert.equal(f.state().releases, 0);
  f.events.emit("exit", { exitCode: 1 }); assert.equal(f.state().releases, 1);
  assert.equal(f.reports().filter(v => v.type === "host_error").length, 0);
});

test("an exited child with unconsumed trailing bytes times out instead of reporting normal completion", t => {
  const f = fixture(t); f.events.emit("data", "tail"); f.events.emit("exit", { exitCode: 0 });
  assert.equal(f.socket.closes.length, 0); t.mock.timers.tick(100);
  assert.equal(f.state().kills, 0);
  assert.equal(f.reports().filter(v => v.type === "host_error" && v.childExitObserved).length, 1);
  f.socket.disconnect(); assert.equal(f.state().releases, 1);
});

test("normal exit waits for final credit, then closes successfully without killing the child", t => {
  const f = fixture(t); f.events.emit("data", "tail"); f.events.emit("exit", { exitCode: 0 });
  f.socket.emit("message", Buffer.from(JSON.stringify({ type: "consumed", total: 4 })), false);
  assert.deepEqual(f.socket.closes, [1000]); f.socket.disconnect(); t.mock.timers.tick(5000);
  assert.equal(f.state().kills, 0); assert.equal(f.state().releases, 1);
  assert.equal(f.reports().filter(v => v.type === "exit").length, 1);
});

test("a thrown exit notification closes as failure and releases the slot after socket cleanup", t => {
  const f = fixture(t);
  f.socket.send = () => { throw new Error("Injected send failure"); };
  assert.doesNotThrow(() => f.events.emit("exit", { exitCode: 0 }));
  assert.equal(f.errors.length, 1); assert.deepEqual(f.socket.closes, [1011]);
  t.mock.timers.tick(1000);
  assert.equal(f.socket.terminations, 1); assert.equal(f.state().releases, 1);
  assert.equal(f.state().kills, 0); assert.equal(f.events.listenerCount("exit"), 0);
});
