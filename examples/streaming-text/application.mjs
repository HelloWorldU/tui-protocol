import { TuiClient } from "@tui-protocol/sdk";
import { setTimeout as delay } from "node:timers/promises";

// Dependencies are application-owned streams; tests supply event-driven fakes.
export async function runApplication({ input = process.stdin, output = process.stdout,
  errorOutput = process.stderr, timeoutMs = 1500, stepMs = 200, deadlineMs = 8000 } = {}) {
  const fragments = ["\nReading input", "\nChecking details", "\nPreparing answer"];
  const result = "Result: the example completed.";
  const controller = new AbortController();
  const client = new TuiClient({ write: bytes => { controller.signal.throwIfAborted(); output.write(bytes); }, timeoutMs });
  const wasRaw = input.isRaw;
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
  const watchdog = setTimeout(() => stop(new Error("Example deadline exceeded")), deadlineMs);
  function ordinary(text) { controller.signal.throwIfAborted(); output.write(text); }
  async function pause() {
    await delay(stepMs, undefined, { signal: controller.signal });
  }
  async function fallback() {
    // This is the example's renderer, not a fallback chosen by the protocol or SDK.
    ordinary("[fallback] Thinking\r\n");
    for (const fragment of fragments) {
      await pause();
      ordinary(fragment.slice(1) + "\r\n");
    }
    ordinary(result + "\r\n");
  }
  try {
    output.on("error", onWriteError);
    input.on("error", onWriteError);
    // Redirected output must stay readable and contain no capability query.
    if (!input.isTTY || !output.isTTY) {
      await fallback();
    } else {
      input.setRawMode(true);
      input.on("data", receive);
      input.on("end", onEnd);
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
    errorOutput.write(`Example stopped: ${error.message}\n`);
  } finally {
    clearTimeout(watchdog);
    client.dispose();
    input.off("data", receive);
    input.off("end", onEnd);
    input.off("error", onWriteError);
    output.off("error", onWriteError);
    if (input.isTTY && !input.destroyed) input.setRawMode(wasRaw ?? false);
    input.pause();
  }
  // Let queued output flush; this finite application owns its process lifetime.
  return exitCode;
}
