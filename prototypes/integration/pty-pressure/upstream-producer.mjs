import { connect } from "node:net";
import { once } from "node:events";
import { TuiClient } from "@tui-protocol/sdk";

// An independent local measurement channel remains readable while PTY output is paused.
const meter = connect(process.env.TUI_PRESSURE_METER);
await once(meter, "connect");
const emit = value => new Promise((resolve, reject) => {
  meter.write(`${JSON.stringify(value)}\n`, error => error ? reject(error) : resolve());
});
let start;
let rejectStart;
const go = new Promise((resolve, reject) => { start = resolve; rejectStart = reject; });
void go.catch(() => {});
let command = "";
meter.on("data", data => {
  command += data.toString();
  if (!"go\n".startsWith(command)) meter.destroy(new Error("Invalid start signal"));
  else if (command === "go\n") start();
});
let ready = Promise.resolve();
let measuring = false;
let wireBytes = 0;
let drainWaits = 0;
let maxWriteMs = 0;
let maxWriteIndex = 0;
let currentIndex = 0;
let maxDrainMs = 0;
let peakWritableLength = 0;
const client = new TuiClient({ timeoutMs: 15_000, write(bytes) {
  const begin = performance.now();
  const accepted = process.stdout.write(bytes);
  if (measuring) {
    wireBytes += bytes.length;
    const elapsed = performance.now() - begin;
    if (elapsed > maxWriteMs) { maxWriteMs = elapsed; maxWriteIndex = currentIndex; }
    peakWritableLength = Math.max(peakWritableLength, process.stdout.writableLength);
  }
  if (!accepted) {
    const waiting = performance.now();
    if (measuring) drainWaits++;
    ready = once(process.stdout, "drain").then(() => {
      if (measuring) maxDrainMs = Math.max(maxDrainMs, performance.now() - waiting);
    });
    void ready.catch(error => client.dispose(error));
  }
} });
const receive = bytes => {
  for (const event of client.receive(bytes)) {
    if (event.type === "error" || (event.type === "message" && event.message.kind === "protocol.error")) {
      client.dispose(new Error("Upstream probe received a protocol error"));
    }
  }
};
meter.on("error", error => { rejectStart(error); client.dispose(error); });
const deadline = setTimeout(() => process.exit(1), 25_000); // Parent has its own independent kill deadline.
try {
  process.stdin.setRawMode(true);
  process.stdin.on("data", receive);
  if (!await client.negotiate()) throw new Error("Expected supporting fixture");
  const context = await client.openContext();
  context.append("upstream", "initial", "mutable"); await ready;
  await emit({ kind: "ready" });
  await go;
  measuring = true;
  const began = performance.now();
  for (let index = 1; index <= 128; index++) {
    await emit({ kind: "before", index });
    currentIndex = index;
    context.update("upstream", `update-${String(index).padStart(3, "0")}\n${"x".repeat(32768)}`);
    await ready;
    await emit({ kind: "after", index, elapsedMs: performance.now() - began,
      wireBytes, drainWaits, maxWriteMs, maxWriteIndex, maxDrainMs, peakWritableLength });
  }
  measuring = false;
  await emit({ kind: "produced" });
  context.seal("upstream"); await ready;
  await context.close();
  await emit({ kind: "closed" });
} catch (error) {
  process.exitCode = 1;
  await emit({ kind: "failure", reason: String(error) }).catch(() => {});
} finally {
  clearTimeout(deadline); client.dispose();
  process.stdin.off("data", receive); process.stdin.setRawMode(false); process.stdin.pause();
  meter.end();
}
