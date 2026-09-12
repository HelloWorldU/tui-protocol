// The prepared package resolves this same name to built JavaScript.
import { TuiClient } from "@tui-protocol/sdk";
import { setTimeout as delay } from "node:timers/promises";

const fragments = ["\nReading input", "\nChecking details", "\nPreparing answer"];
const result = "Result: the example completed.";
const controller = new AbortController();
const client = new TuiClient({ write: bytes => { process.stdout.write(bytes); }, timeoutMs: 1500 });
const wasRaw = process.stdin.isRaw;
let exitCode = 0;
function stop(error) {
  controller.abort(error);
  client.dispose(error);
}
function receive(bytes) {
  if (controller.signal.aborted) return;
  for (const event of client.receive(bytes)) {
    if (event.type === "ordinary" && event.data.includes(3)) stop(new Error("Interrupted"));
    if (event.type === "error") stop(new Error(event.reason));
    if (event.type === "message" && event.message.kind === "protocol.error") {
      stop(new Error(`Operation rejected: ${event.message.body.code}`));
    }
  }
}
const onEnd = () => stop(new Error("Input stream ended"));
const onWriteError = error => stop(error);
const watchdog = setTimeout(() => stop(new Error("Example deadline exceeded")), 8000);
async function pause() {
  await delay(200, undefined, { signal: controller.signal });
}
async function fallback() {
  // This is the example's renderer, not a fallback chosen by the protocol or SDK.
  process.stdout.write("[fallback] Thinking\r\n");
  for (const fragment of fragments) {
    await pause();
    process.stdout.write(fragment.slice(1) + "\r\n");
  }
  process.stdout.write(result + "\r\n");
}
try {
  process.stdout.on("error", onWriteError);
  // Redirected output must stay readable and contain no capability query.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    await fallback();
  } else {
    process.stdin.setRawMode(true);
    process.stdin.on("data", receive);
    process.stdin.on("end", onEnd);
    if (!await client.negotiate()) {
      await fallback();
    } else {
      const context = await client.openContext();
      let sentState = context.append("thinking", "Thinking", "mutable");
      for (const fragment of fragments) {
        await pause();
        sentState = context.extend("thinking", sentState, fragment);
      }
      // A returned ID means sent, not acknowledged. Rejections stop this example.
      context.update("thinking", "Thinking complete");
      context.seal("thinking");
      context.append("answer", result, "sealed");
      await context.close();
    }
  }
} catch (error) {
  exitCode = 1;
  process.stderr.write(`Example stopped: ${error.message}\n`);
} finally {
  clearTimeout(watchdog);
  client.dispose();
  process.stdin.off("data", receive);
  process.stdin.off("end", onEnd);
  if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false);
  process.stdin.pause();
}
// Let queued output flush; this finite application owns its process lifetime.
process.exitCode = exitCode;
