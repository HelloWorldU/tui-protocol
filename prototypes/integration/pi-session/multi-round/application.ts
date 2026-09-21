import { TuiClient } from "@tui-protocol/sdk";
import type { ApplicationOptions } from "../application.ts";
import { PiEventAdapter } from "../event-adapter.ts";
import { runPiSession } from "../session-runner.ts";
import { CommandReader, type Command } from "./commands.ts";

export interface MultiRoundOptions extends ApplicationOptions { maxRounds?: number; turnDeadlineMs?: number }

/** One retained Pi conversation; each finite turn owns a fresh display Context. */
export async function runMultiRound(options: MultiRoundOptions): Promise<"quit" | "limit" | "unsupported"> {
  const { input, output } = options;
  const maxRounds = options.maxRounds ?? 5;
  const deadlineMs = options.deadlineMs ?? 600_000;
  const turnDeadlineMs = options.turnDeadlineMs ?? 60_000;
  const maxQueuedBytes = options.maxQueuedBytes ?? 256 * 1024;
  for (const value of [maxRounds, deadlineMs, turnDeadlineMs, maxQueuedBytes]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid multi-round budget");
  }
  const wasRaw = input.isRaw ?? false;
  let source: Awaited<ReturnType<ApplicationOptions["createSource"]>> | undefined;
  let adapter: PiEventAdapter | undefined;
  let cancel: AbortController | undefined;
  let failure: Error | undefined;
  let quitting = false;
  let waiting: ((prompt: string | undefined) => void) | undefined;
  const write = (bytes: Uint8Array | string) => {
    if (failure) throw failure;
    if (output.destroyed || output.writableEnded) throw new Error("Output closed");
    const length = typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength;
    if (output.writableLength + length > maxQueuedBytes) throw new Error("Application output budget exceeded");
    output.write(bytes);
  };
  const client = new TuiClient({ write, timeoutMs: options.timeoutMs ?? 1500 });
  const fail = (error: unknown) => {
    failure ??= error instanceof Error ? error : new Error(String(error));
    adapter?.fail(failure);
    cancel?.abort();
    client.dispose(failure);
    const resolve = waiting; waiting = undefined; resolve?.(undefined);
  };
  const command = (value: Command) => {
    if (value.type === "quit") {
      quitting = true; cancel?.abort();
      const resolve = waiting; waiting = undefined; resolve?.(undefined);
    } else if (value.type === "cancel") cancel?.abort();
    else if (waiting && !quitting) {
      const resolve = waiting; waiting = undefined;
      cancel = new AbortController();
      resolve(value.text);
    } else write("[busy: prompt not accepted; send again when ready]\r\n");
  };
  const reader = new CommandReader();
  const receive = (bytes: Buffer) => {
    if (failure) return;
    try {
      for (const event of client.receive(bytes)) {
        if (event.type === "error") throw new Error(`Protocol input failed: ${event.reason}`);
        if (event.type === "message" && event.message.kind === "protocol.error") {
          throw new Error(`Terminal rejected Operation: ${event.message.body.code}`);
        }
        if (event.type === "ordinary") reader.push(event.data, command);
      }
    } catch (error) { fail(error); }
  };
  const inputEnded = () => fail(new Error("Application input ended"));
  const outputClosed = () => fail(new Error("Application output closed"));
  const deadline = setTimeout(() => fail(new Error("Application deadline exceeded")), deadlineMs);
  try {
    output.on("error", fail); output.on("close", outputClosed);
    if (!input.isTTY || !output.isTTY || !input.setRawMode) {
      write("Pi multi-round trial requires a supporting host; no session was started.\n");
      return "unsupported";
    }
    input.setRawMode(true);
    input.on("data", receive); input.on("end", inputEnded); input.on("error", fail); input.resume();
    if (!await client.negotiate()) {
      write("Pi protocol unsupported; no session was started.\r\n"); return "unsupported";
    }
    if (failure) throw failure;
    if (quitting) return "quit";
    source = await options.createSource();
    if (failure) throw failure;
    for (let round = 1; round <= maxRounds && !quitting; round++) {
      const next = new Promise<string | undefined>(resolve => { waiting = resolve; });
      write(`[ready ${round}/${maxRounds}] Submit a prompt using the form.\r\n`);
      const prompt = await next;
      if (failure) throw failure;
      if (prompt === undefined) break;
      const turnTimer = setTimeout(() => fail(new Error("Pi turn deadline exceeded")), turnDeadlineMs);
      try {
        const context = await client.openContext();
        adapter = new PiEventAdapter(context);
        const outcome = await runPiSession(source.session, adapter, { prompt, signal: cancel!.signal });
        if (failure) throw failure;
        await context.close();
        if (failure) throw failure;
        write(`[round ${round} ${outcome}]\r\n`);
      } finally { clearTimeout(turnTimer); adapter = undefined; cancel = undefined; }
    }
    if (failure) throw failure;
    write(quitting ? "[session ended by user]\r\n" : "[trial round limit reached]\r\n");
    return quitting ? "quit" : "limit";
  } finally {
    clearTimeout(deadline); waiting = undefined; client.dispose();
    input.off("data", receive); input.off("end", inputEnded); input.off("error", fail);
    try { if (input.isTTY && input.setRawMode) input.setRawMode(wasRaw); }
    finally {
      input.pause();
      try { await source?.dispose(); }
      finally { output.off("error", fail); output.off("close", outputClosed); }
    }
  }
}
