import { pathToFileURL } from "node:url";
import WebSocket, { type RawData } from "ws";
import type { FrontendRole } from "./pair-transport.ts";
import type { TrialInput, TrialOutput } from "./terminal.ts";

export interface ChannelClientOptions {
  readonly role: FrontendRole;
  readonly url: string;
  readonly input: TrialInput;
  readonly output: TrialOutput;
  readonly onError?: (error: Error) => void;
}

export interface ChannelClient {
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

export function connectChannel(options: ChannelClientOptions): ChannelClient {
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveClosed!: () => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const socket = new WebSocket(options.url);
  const role = options.role;
  let acknowledged = false;
  let cleaned = false;
  let closing = false;
  const wasRaw = options.input.isRaw ?? false;
  const resize = () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "resize",
        columns: options.output.columns ?? 80,
        rows: options.output.rows ?? 24,
      }));
    }
  };
  const input = (chunk: Buffer | string) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
  };
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    options.output.off("resize", resize);
    options.input.off("data", input);
    options.input.pause();
    if (options.input.setRawMode) options.input.setRawMode(wasRaw);
  };
  const close = async () => {
    if (closing) return closed;
    closing = true;
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else if (socket.readyState !== WebSocket.CLOSED) socket.close();
    return closed;
  };

  socket.on("open", () => {
    socket.send(JSON.stringify({
      type: "hello",
      role,
      columns: options.output.columns ?? 80,
      rows: options.output.rows ?? 24,
    }));
    options.output.on("resize", resize);
    if (role === "protocol") {
      options.input.on("data", input);
      if (options.input.setRawMode) options.input.setRawMode(true);
      options.input.resume();
    } else {
      options.input.pause();
    }
  });
  socket.on("message", (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      if (!options.output.write(data)) {
        socket.pause();
        options.output.once("drain", () => socket.resume());
      }
      return;
    }
    try {
      const message = JSON.parse(data.toString());
      if (message.type !== "helloAck" || message.role !== role) throw new Error("Unexpected channel control message");
      if (!acknowledged) {
        acknowledged = true;
        resolveReady();
      }
    } catch (error) {
      rejectReady(error instanceof Error ? error : new Error(String(error)));
      void close();
    }
  });
  socket.on("error", error => {
    if (!acknowledged) rejectReady(error);
    options.onError?.(error);
  });
  socket.on("close", () => {
    cleanup();
    if (!acknowledged) rejectReady(new Error("Channel closed before the hello acknowledgement"));
    resolveClosed();
  });

  return { ready, closed, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const role = process.argv[2];
  const token = process.argv[3];
  if ((role !== "stock" && role !== "protocol") || !token) {
    console.error("Usage: node channel-client.ts <stock|protocol> <token>");
    process.exitCode = 1;
  } else {
    const port = Number(process.env.PI_PAIR_PORT ?? 4194);
    const client = connectChannel({
      role,
      url: `ws://127.0.0.1:${port}/?role=${role}&token=${encodeURIComponent(token)}`,
      input: process.stdin,
      output: process.stdout,
      onError: error => console.error(`[pair:${role}] ${error.message}`),
    });
    client.ready.then(() => {
      const title = role === "stock" ? "STOCK - Pi fallback" : "PROTOCOL - mutable history";
      process.stdout.write(`\x1b]0;${title}\x07`);
      console.error(`[pair:${role}] connected`);
    }).catch(error => {
      console.error(`[pair:${role}] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
    process.on("SIGINT", () => { void client.close(); });
    process.on("SIGTERM", () => { void client.close(); });
  }
}
