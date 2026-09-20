import type { Readable, Writable } from "node:stream";
import { TuiClient } from "@tui-protocol/sdk";
import { PiEventAdapter } from "./event-adapter.ts";
import { createTrialSession } from "./session-source.ts";
import { runPiSession } from "./session-runner.ts";

type Input = Readable & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (raw: boolean) => unknown };
type Output = Writable & { isTTY?: boolean };
export interface ApplicationOptions {
  input: Input;
  output: Output;
  createSource: () => Promise<Awaited<ReturnType<typeof createTrialSession>>>;
  timeoutMs?: number;
  deadlineMs?: number;
  maxQueuedBytes?: number;
}

/** Finite application transport/cleanup, separate from the model source and terminal host. */
export async function runApplication(options: ApplicationOptions): Promise<"completed" | "aborted" | "unsupported"> {
  const { input, output } = options;
  const maxQueuedBytes = options.maxQueuedBytes ?? 256 * 1024;
  const deadlineMs = options.deadlineMs ?? 60_000;
  for (const value of [maxQueuedBytes, deadlineMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Application budgets must be positive integers");
  }
  const cancel = new AbortController();
  const wasRaw = input.isRaw ?? false;
  let failure: Error | undefined;
  let adapter: PiEventAdapter | undefined;
  let source: Awaited<ReturnType<typeof createTrialSession>> | undefined;
  let resolveStart: ((start: boolean) => void) | undefined;
  let acceptingStart = false;
  const write = (bytes: Uint8Array | string) => {
    if (failure) throw failure;
    if (output.destroyed || output.writableEnded) throw new Error("Output is closed");
    const size = typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength;
    if (output.writableLength + size > maxQueuedBytes) throw new Error("Application output budget exceeded");
    output.write(bytes);
  };
  const client = new TuiClient({ write, timeoutMs: options.timeoutMs ?? 1500 });
  const fail = (error: unknown) => {
    failure ??= error instanceof Error ? error : new Error(String(error));
    adapter?.fail(failure);
    client.dispose(failure);
    cancel.abort();
    resolveStart?.(false);
  };
  const receive = (bytes: Buffer) => {
    if (failure) return;
    try {
      for (const event of client.receive(bytes)) {
        if (event.type === "error") throw new Error(`Protocol input failed: ${event.reason}`);
        if (event.type === "message" && event.message.kind === "protocol.error") {
          throw new Error(`Terminal rejected Operation: ${event.message.body.code}`);
        }
        if (event.type === "ordinary") {
          for (const byte of event.data) {
            if (byte === 113 || byte === 3) { cancel.abort(); resolveStart?.(false); }
            if (byte === 110 && acceptingStart && !cancel.signal.aborted) {
              acceptingStart = false;
              resolveStart?.(true);
            }
          }
        }
      }
    } catch (error) { fail(error); }
  };
  const inputEnded = () => fail(new Error("Application input ended"));
  const outputClosed = () => fail(new Error("Application output closed"));
  const deadline = setTimeout(() => fail(new Error("Application deadline exceeded")), deadlineMs);
  try {
    output.on("error", fail);
    output.on("close", outputClosed);
    if (!input.isTTY || !output.isTTY || !input.setRawMode) {
      write("Pi trial requires a supporting terminal host; no session was started.\n");
      return "unsupported";
    }
    input.setRawMode(true);
    input.on("data", receive);
    input.on("end", inputEnded);
    input.on("error", fail);
    input.resume();
    const supported = await client.negotiate();
    if (cancel.signal.aborted) { if (failure) throw failure; return "aborted"; }
    if (!supported) {
      write("Pi trial protocol unsupported; no session was started.\r\n");
      return "unsupported";
    }
    source = await options.createSource();
    if (failure) throw failure;
    if (cancel.signal.aborted) return "aborted";
    const start = new Promise<boolean>(resolve => { resolveStart = resolve; });
    acceptingStart = true;
    write("[ready] n: start one Pi turn, q: cancel\r\n");
    if (!await start) { if (failure) throw failure; return "aborted"; }
    const context = await client.openContext();
    adapter = new PiEventAdapter(context);
    const outcome = await runPiSession(source.session, adapter, { signal: cancel.signal });
    if (failure) throw failure;
    await context.close();
    if (failure) throw failure;
    write(outcome === "aborted" ? "[stopped by user]\r\n" : "[Pi turn complete]\r\n");
    return outcome;
  } finally {
    clearTimeout(deadline);
    acceptingStart = false;
    resolveStart?.(false);
    client.dispose();
    input.off("data", receive);
    input.off("end", inputEnded);
    input.off("error", fail);
    try {
      if (input.isTTY && input.setRawMode) input.setRawMode(wasRaw);
    } finally {
      input.pause();
      try { await source?.dispose(); }
      finally { output.off("error", fail); output.off("close", outputClosed); }
    }
  }
}
