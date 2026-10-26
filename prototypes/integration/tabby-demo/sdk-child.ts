import assert from "node:assert/strict";
import { TuiClient } from "@tui-protocol/sdk";

let client: TuiClient | undefined;
const onData = (data: Buffer) => client?.receive(data);

async function main(): Promise<void> {
  process.stdout.write("SHELL_BEFORE\r\n");
  client = new TuiClient({
    write: bytes => { process.stdout.write(bytes); },
    timeoutMs: 5000,
  });
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on("data", onData);
  assert.equal(await client.negotiate(), true);
  const context = await client.openContext();
  context.append("answer", "ORIGINAL_BLOCK", "mutable");
  context.update("answer", "UPDATED_BLOCK\nsecond line");
  await context.close();
  process.stdout.write("SHELL_AFTER\r\n");
}

try {
  await main();
} catch (error) {
  console.error("Tabby demo SDK child failed:", error);
  process.exitCode = 1;
} finally {
  client?.finish();
  process.stdin.off("data", onData);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}
