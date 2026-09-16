import { once } from "node:events";
import { TuiClient } from "@tui-protocol/sdk";

// Finite fixed workload; the application respects Node stdout's drain signal.
let ready = Promise.resolve();
let drainWaits = 0;
const client = new TuiClient({ timeoutMs: 15_000, write(bytes) {
  if (!process.stdout.write(bytes)) {
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
  for (let index = 1; index <= 256; index++) {
    context.update("pressure", `value-${String(index).padStart(4, "0")}\n${"x".repeat(2048)}`);
    await ready;
  }
  context.seal("pressure"); await ready;
  await context.close();
  process.stdout.write(`PRODUCER:${JSON.stringify({ updates: 256, drainWaits })}\r\n`);
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`Pressure producer failed: ${error.message}\r\n`);
} finally {
  clearTimeout(deadline); client.dispose();
  process.stdin.off("data", receive);
  if (!process.stdin.destroyed) { process.stdin.setRawMode(false); process.stdin.pause(); }
}
