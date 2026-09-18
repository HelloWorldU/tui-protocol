import { once } from "node:events";
import { TuiClient } from "@tui-protocol/sdk";
import workload from "./workload.json" with { type: "json" };

// Finite fixed workload; the application respects Node stdout's drain signal.
let ready = Promise.resolve();
let drainWaits = 0;
let index = 0;
let longestWrite = { index: 0, durationMs: 0, startedAt: 0, endedAt: 0 };
const client = new TuiClient({ timeoutMs: 15_000, write(bytes) {
  const startedAt = Date.now();
  const began = performance.now();
  const accepted = process.stdout.write(bytes);
  const durationMs = performance.now() - began;
  if (durationMs > longestWrite.durationMs) longestWrite = { index, durationMs, startedAt, endedAt: Date.now() };
  if (!accepted) {
    drainWaits++;
    ready = once(process.stdout, "drain").then(() => {});
    void ready.catch(error => client.dispose(error));
  }
} });
const receive = bytes => {
  for (const event of client.receive(bytes)) {
    if (event.type === "error" || (event.type === "message" && event.message.kind === "protocol.error")) {
      client.dispose(new Error("Pressure producer received a protocol failure"));
    }
  }
};
const deadline = setTimeout(() => { client.dispose(); process.exitCode = 1; process.stdin.destroy(); }, 30_000);
try {
  process.stdin.setRawMode(true);
  process.stdin.on("data", receive);
  if (!await client.negotiate()) throw new Error("Expected supporting test terminal");
  const context = await client.openContext();
  context.append("pressure", "initial", "mutable"); await ready;
  for (index = 1; index <= workload.updates; index++) {
    context.update("pressure", `value-${String(index).padStart(4, "0")}\n${"x".repeat(workload.padding)}`);
    await ready;
  }
  index = 0; // Control/Seal writes must not look like a content Update.
  context.seal("pressure"); await ready;
  await context.close();
  process.stdout.write(`PRODUCER:${JSON.stringify({ updates: workload.updates, drainWaits, longestWrite })}\r\n`);
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`Pressure producer failed: ${error.message}\r\n`);
} finally {
  clearTimeout(deadline); client.dispose();
  process.stdin.off("data", receive);
  if (!process.stdin.destroyed) { process.stdin.setRawMode(false); process.stdin.pause(); }
}
