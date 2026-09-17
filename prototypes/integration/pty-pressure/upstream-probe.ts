import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as pty from "node-pty";
import { TerminalProtocolEndpoint } from "@tui-protocol/terminal";
import { buildSdk } from "../../../sdk/build.ts";

interface Progress {
  index: number;
  elapsedMs: number;
  wireBytes: number;
  drainWaits: number;
  maxWriteMs: number;
  maxWriteIndex: number;
  maxDrainMs: number;
  peakWritableLength: number;
}

/** Real ConPTY transport isolation: no browser, WebSocket, or native renderer. */
export async function measureUpstream(producer: string, pauseMs: 0 | 2000) {
  assert.equal(process.platform, "win32", "This fixture requires Windows bundled ConPTY");
  const address = `\\\\.\\pipe\\tui-pressure-${randomUUID()}`;
  let child: pty.IPty | undefined;
  let meter: Socket | undefined;
  let exitCode: number | undefined;
  let meterEnded = false;
  let validatedUpdates = 0;
  let receivedBytes = 0;
  let before = 0;
  let progress: Progress | undefined;
  let produced = false;
  let closed = false;
  let began: number | undefined;
  let resumeAtMs: number | undefined;
  let readySeen = false;
  const samples: { atMs: number; before: number; completed: number; receivedBytes: number; produced: boolean }[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let fail!: (reason: unknown) => void;
  let finish!: () => void;
  const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  void done.catch(() => {});
  const endpoint = new TerminalProtocolEndpoint({ completeBaselineSupported: true, operationAdapter: {
    prepare: () => undefined,
    accept(operation) {
      if (operation.kind === "block.update") {
        validatedUpdates++;
        assert.equal(operation.body.content.data, `update-${String(validatedUpdates).padStart(3, "0")}\n${"x".repeat(32768)}`);
      }
    },
  } });
  function maybeFinish() { if (exitCode !== undefined && meterEnded) finish(); }
  function snapshot() {
    samples.push({ atMs: performance.now() - began!, before, completed: progress?.index ?? 0, receivedBytes, produced });
  }
  const server = createServer(socket => {
    if (meter) { socket.destroy(); return; }
    meter = socket;
    let input = "";
    let total = 0;
    socket.setEncoding("utf8");
    socket.on("data", data => {
      try {
        total += Buffer.byteLength(data);
        assert.ok(total <= 262_144, "Measurement channel exceeded 256 KiB");
        input += data;
        for (let end; (end = input.indexOf("\n")) >= 0;) {
          const message = JSON.parse(input.slice(0, end)); input = input.slice(end + 1);
          if (message.kind === "ready") {
            assert.equal(readySeen, false); readySeen = true;
            if (pauseMs) child!.pause();
            began = performance.now();
            socket.write("go\n");
            if (pauseMs) {
              timers.push(setTimeout(snapshot, pauseMs / 2));
              timers.push(setTimeout(() => {
                snapshot(); resumeAtMs = performance.now() - began!; child!.resume();
              }, pauseMs));
            }
          } else if (message.kind === "before") {
            assert.equal(message.index, before + 1); before = message.index;
          } else if (message.kind === "after") {
            assert.equal(message.index, (progress?.index ?? 0) + 1);
            progress = message;
          } else if (message.kind === "produced") produced = true;
          else if (message.kind === "closed") closed = true;
          else throw new Error(`Producer measurement failure: ${JSON.stringify(message)}`);
        }
      } catch (error) { fail(error); }
    });
    socket.on("error", fail);
    socket.on("end", () => { meterEnded = true; if (input) fail(new Error("Truncated measurement record")); maybeFinish(); });
  });
  server.on("error", fail);
  const deadline = setTimeout(() => fail(new Error("Upstream probe exceeded 20 seconds")), 20_000);
  const subscriptions: { dispose(): void }[] = [];
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(address, resolve); });
    child = pty.spawn(process.execPath, ["--no-experimental-strip-types", producer], {
      cols: 40, rows: 8, name: "xterm-256color", useConptyDll: true,
      cwd: process.cwd(), env: { ...process.env, TUI_PRESSURE_METER: address },
    });
    subscriptions.push(child.onData(data => {
      try {
        const bytes = Buffer.from(data, "utf8"); receivedBytes += bytes.length;
        assert.ok(receivedBytes <= 8 * 1024 * 1024, "PTY output exceeded 8 MiB");
        const result = endpoint.push(bytes);
        assert.deepEqual(result.diagnostics, []);
        for (const frame of result.responseFrames) child!.write(Buffer.from(frame).toString("utf8"));
      } catch (error) { fail(error); }
    }));
    subscriptions.push(child.onExit(event => {
      exitCode = event.exitCode;
      if (exitCode !== 0) fail(new Error(`Upstream child exited: ${exitCode}`));
      else maybeFinish();
    }));
    await done;
    assert.equal(exitCode, 0); assert.ok(readySeen && produced && closed);
    assert.equal(progress?.index, 128); assert.equal(validatedUpdates, 128);
    assert.equal(endpoint.contexts()[0]?.state, "closed");
    assert.equal(endpoint.contexts()[0]?.blocks[0]?.lifecycle, "sealed");
    assert.equal(endpoint.contexts()[0]?.blocks[0]?.content.data, `update-128\n${"x".repeat(32768)}`);
    assert.deepEqual(endpoint.finish().diagnostics, []);
    return { pauseMs, resumeAtMs, samples, progress, receivedBytes, validatedUpdates, exitCode };
  } finally {
    clearTimeout(deadline); timers.forEach(clearTimeout);
    subscriptions.forEach(subscription => subscription.dispose());
    meter?.destroy();
    if (child && exitCode === undefined) child.kill();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const output = buildSdk();
    const producer = join(output, "upstream-producer.mjs");
    copyFileSync(fileURLToPath(new URL("./upstream-producer.mjs", import.meta.url)), producer);
    const results = [await measureUpstream(producer, 0), await measureUpstream(producer, 2000)];
    process.stdout.write(JSON.stringify({ scope: "SDK stdout through bundled ConPTY; independent local measurement pipe", results }, null, 2) + "\n", () => process.exit(0));
  } catch (error) { console.error(error); process.exit(1); }
}
