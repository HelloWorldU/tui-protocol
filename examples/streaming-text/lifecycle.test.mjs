import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { ProtocolStreamDecoder, encodeMessageFrames } from "@tui-protocol/protocol";
import { TerminalProtocolSession } from "@tui-protocol/terminal";
import { runApplication } from "./application.mjs";

async function run(mode, wasRaw = false) {
  class Input extends EventEmitter {
    isTTY = true; isRaw = wasRaw; destroyed = false; paused = false;
    setRawMode(raw) { this.isRaw = raw; }
    pause() { this.paused = true; }
  }
  const input = new Input(); const messages = []; const plain = []; const errors = [];
  const decoder = new ProtocolStreamDecoder(); const session = new TerminalProtocolSession({ completeBaselineSupported: mode !== "unsupported" });
  let injected = false;
  class Output extends EventEmitter {
    isTTY = true;
    write(bytes) {
      if (typeof bytes === "string") { plain.push(bytes); return true; }
      for (const event of decoder.push(bytes)) {
        if (event.type !== "message") continue;
        const message = event.message; messages.push(message);
        if (mode === "silent") continue;
        if (message.kind === "block.append" && !injected && mode !== "supported") {
          injected = true;
          if (mode === "write-throw") throw new Error("Injected write failure");
          queueMicrotask(() => {
            if (mode === "rejected") for (const frame of encodeMessageFrames({ version: 1, kind: "protocol.error", context_id: message.context_id, operation_id: message.operation_id, body: { code: "resource_exhausted" } }, 99)) input.emit("data", frame);
            if (mode === "end") input.emit("end");
            if (mode === "write-error") output.emit("error", new Error("Injected write error"));
            if (mode === "interrupt") input.emit("data", new Uint8Array([3]));
            if (mode === "input-error") input.emit("error", new Error("Injected input error"));
          });
        } else for (const response of session.handle(message)) {
          queueMicrotask(() => { for (const frame of encodeMessageFrames(response, 1)) input.emit("data", frame); });
        }
      }
      return true;
    }
  }
  const output = new Output();
  const status = await runApplication({ input, output, errorOutput: { write(text) { errors.push(text); } }, timeoutMs: 15, stepMs: 2, deadlineMs: 1000 });
  assert.equal(input.isRaw, wasRaw); assert(input.paused);
  assert.equal(input.listenerCount("data"), 0); assert.equal(input.listenerCount("end"), 0);
  assert.equal(input.listenerCount("error"), 0); assert.equal(output.listenerCount("error"), 0);
  return { status, messages, plain: plain.join(""), errors: errors.join("") };
}

for (const mode of ["unsupported", "silent"]) test(`${mode} negotiation uses application fallback, sends no Block Operations, and restores input mode`, async () => {
  const r = await run(mode); assert.equal(r.status, 0); assert(r.plain.startsWith("[fallback]"));
  assert.deepEqual(r.messages.map(m => m.kind), ["capability.query"]); assert.equal(r.errors, "");
});

for (const mode of ["rejected", "end", "write-error", "write-throw", "interrupt", "input-error"]) test(`${mode} during protocol output stops later sends, never starts fallback, and restores input mode`, async () => {
  const r = await run(mode, true); assert.equal(r.status, 1); assert.equal(r.plain, "");
  assert.deepEqual(r.messages.map(m => m.kind), ["capability.query", "context.open", "block.append"]);
  assert(r.errors.includes("Example stopped:"));
});

test("successful application closes its Context, emits no fallback, and removes stream listeners", async () => {
  const r = await run("supported"); assert.equal(r.status, 0); assert.equal(r.plain, "");
  assert.equal(r.messages.at(-1)?.kind, "context.close"); assert.equal(r.errors, "");
});
