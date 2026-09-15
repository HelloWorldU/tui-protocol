import { TuiClient } from "@tui-protocol/sdk";
import { setTimeout as delay } from "node:timers/promises";
import { Commands } from "./commands.mjs";
import { fallbackTranscript, ROUND_LIMIT, runRound } from "./rounds.mjs";

const commands = new Commands();
const client = new TuiClient({ write: bytes => { process.stdout.write(bytes); }, timeoutMs: 1500 });
const wasRaw = process.stdin.isRaw;
let failure;
function fail(error) {
  failure ??= error;
  commands.stop();
  client.dispose(error);
}
function receive(bytes) {
  if (failure) return;
  for (const event of client.receive(bytes)) {
    if (event.type === "ordinary") commands.feed(event.data);
    if (event.type === "error") fail(new Error(event.reason));
    if (event.type === "message" && event.message.kind === "protocol.error") {
      fail(new Error(`Operation rejected: ${event.message.body.code}`));
    }
  }
}
const inputEnded = () => fail(new Error("Input stream ended"));
const deadline = setTimeout(() => fail(new Error("Two-minute example deadline exceeded")), 120_000);
try {
  process.stdout.on("error", fail);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(fallbackTranscript());
  } else {
    process.stdin.setRawMode(true);
    process.stdin.on("data", receive);
    process.stdin.on("end", inputEnded);
    process.stdin.on("error", fail);
    const supported = await client.negotiate();
    if (!commands.signal.aborted && !supported) {
      process.stdout.write(fallbackTranscript());
    } else if (!commands.signal.aborted) {
      const context = await client.openContext();
      for (let round = 1; round <= ROUND_LIMIT; round++) {
        const next = commands.next();
        process.stdout.write(`[ready ${round}/${ROUND_LIMIT}] n: next, q: quit\r\n`);
        if (!await next) break;
        try {
          await runRound(context, round, () => delay(1000, undefined, { signal: commands.signal }));
        } catch (error) {
          if (failure || !commands.signal.aborted) throw error;
          break; // User quit during a pause; retain partial content, then close.
        }
      }
      if (failure) throw failure;
      await context.close();
      process.stdout.write(commands.signal.aborted ? "[stopped by user]\r\n" : "[three rounds complete]\r\n");
    }
    if (failure) throw failure;
  }
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`Example stopped: ${error.message}\n`);
} finally {
  clearTimeout(deadline);
  commands.stop();
  client.dispose();
  process.stdin.off("data", receive);
  process.stdin.off("end", inputEnded);
  process.stdin.off("error", fail);
  if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false);
  process.stdin.pause();
}
