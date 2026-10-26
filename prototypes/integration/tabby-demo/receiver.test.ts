import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as pty from "node-pty";
import headless from "@xterm/headless";
import type { Terminal as BrowserTerminal } from "@xterm/xterm";
import { TuiClient } from "@tui-protocol/sdk";
import { TabbyProtocolReceiver } from "./receiver.ts";

const { Terminal } = headless;
type HeadlessTerminal = InstanceType<typeof Terminal>;

function bufferText(terminal: HeadlessTerminal): string {
  const buffer = terminal.buffer.active;
  return Array.from({ length: buffer.length }, (_, row) =>
    buffer.getLine(row)?.translateToString(true) ?? "").join("\n");
}

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function createTerminal(): HeadlessTerminal {
  return new Terminal({ allowProposedApi: true, cols: 40, rows: 8, scrollback: 100 });
}

test("split SDK negotiation and a historical Update preserve ordinary output and return responses", async () => {
  const terminal = createTerminal();
  const failures: Error[] = [];
  let client!: TuiClient;
  let splitNextWrite = true;
  const receiver = new TabbyProtocolReceiver({
    terminal: terminal as unknown as BrowserTerminal,
    region: false,
    onResponseFrame: frame => { client.receive(frame); },
    onFailure: error => failures.push(error),
  });
  client = new TuiClient({
    write: bytes => {
      if (splitNextWrite) {
        splitNextWrite = false;
        for (const byte of bytes) receiver.feed(Uint8Array.of(byte));
      } else {
        receiver.feed(bytes);
      }
    },
  });
  try {
    receiver.feed(new TextEncoder().encode("shell-before\r\n"));
    assert.equal(await client.negotiate(), true);
    assert.equal(client.supportsStyledContent, true);
    assert.equal(client.supportsLinesContent, true);
    const context = await client.openContext();
    context.append("answer", "ORIGINAL_BLOCK", "mutable");
    await receiver.drain();
    context.update("answer", "UPDATED_BLOCK\nsecond line");
    await receiver.drain();
    receiver.feed(new TextEncoder().encode("shell-after\r\n"));
    await context.close();
    await receiver.finish();

    const rendered = bufferText(terminal);
    assert.equal(occurrences(rendered, "shell-before"), 1);
    assert.equal(occurrences(rendered, "shell-after"), 1);
    assert.equal(occurrences(rendered, "ORIGINAL_BLOCK"), 0);
    assert.equal(occurrences(rendered, "UPDATED_BLOCK"), 1);
    assert.equal(occurrences(rendered, "second line"), 1);
    assert.deepEqual(receiver.contexts().map(context => context.state), ["closed"]);
    assert.deepEqual(failures, []);
  } finally {
    client.dispose();
    receiver.dispose();
    terminal.dispose();
  }
});

test("finish ignores later input and dispose leaves the Tabby-owned terminal alive", async () => {
  const terminal = createTerminal();
  const receiver = new TabbyProtocolReceiver({
    terminal: terminal as unknown as BrowserTerminal,
    onResponseFrame: () => {},
  });
  try {
    await receiver.finish();
    receiver.feed(new TextEncoder().encode("not-rendered"));
    await receiver.drain();
    assert.equal(bufferText(terminal).includes("not-rendered"), false);
    receiver.dispose();
    await new Promise<void>(resolve => terminal.write("terminal-alive", resolve));
    assert.equal(bufferText(terminal).includes("terminal-alive"), true);
  } finally {
    receiver.dispose();
    terminal.dispose();
  }
});

test("a real SDK child exchanges protocol responses through bundled ConPTY while ordinary output uses the host callback", { skip: process.platform !== "win32" }, async () => {
  const terminal = createTerminal();
  const failures: Error[] = [];
  const ordinary: string[] = [];
  let child: pty.IPty | undefined;
  const receiver = new TabbyProtocolReceiver({
    terminal: terminal as unknown as BrowserTerminal,
    writeOrdinary: async data => {
      ordinary.push(Buffer.from(data).toString());
      await new Promise<void>(resolve => terminal.write(data, resolve));
    },
    onResponseFrame: frame => { child?.write(Buffer.from(frame).toString()); },
    onFailure: error => failures.push(error),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dataSubscription: { dispose(): void } | undefined;
  let exitSubscription: { dispose(): void } | undefined;
  try {
    child = pty.spawn(process.execPath, [fileURLToPath(new URL("./sdk-child.ts", import.meta.url))], {
      name: "xterm-256color",
      cols: 40,
      rows: 8,
      cwd: process.cwd(),
      env: process.env,
      useConptyDll: true,
    });
    dataSubscription = child.onData(data => receiver.feed(Buffer.from(data)));
    const exited = new Promise<number>((resolve, reject) => {
      exitSubscription = child!.onExit(event => resolve(event.exitCode));
      timer = setTimeout(() => {
        child?.kill();
        reject(new Error("Timed out waiting for the SDK child."));
      }, 15000);
    });
    const exitCode = await exited;
    await receiver.finish();

    const rendered = bufferText(terminal);
    assert.equal(exitCode, 0, rendered);
    assert.equal(occurrences(rendered, "SHELL_BEFORE"), 1);
    assert.equal(occurrences(rendered, "SHELL_AFTER"), 1);
    assert.equal(occurrences(rendered, "ORIGINAL_BLOCK"), 0);
    assert.equal(occurrences(rendered, "UPDATED_BLOCK"), 1);
    assert.equal(occurrences(rendered, "second line"), 1);
    assert.match(ordinary.join(""), /SHELL_BEFORE/);
    assert.match(ordinary.join(""), /SHELL_AFTER/);
    assert.deepEqual(receiver.contexts().map(context => context.state), ["closed"]);
    assert.deepEqual(failures, []);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    try { child?.kill(); } catch {}
    dataSubscription?.dispose();
    exitSubscription?.dispose();
    receiver.dispose();
    terminal.dispose();
    const conoutWorker = (child as unknown as {
      _agent?: { _conoutSocketWorker?: { dispose(): void } };
    } | undefined)?._agent?._conoutSocketWorker;
    // This standalone test must explicitly release node-pty's bundled-ConPTY
    // reader after natural exit; the plugin leaves PTY lifetime to Tabby.
    conoutWorker?.dispose();
    if (conoutWorker !== undefined) {
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
  }
});
