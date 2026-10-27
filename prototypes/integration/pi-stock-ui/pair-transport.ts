import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";

export type FrontendRole = "stock" | "protocol";

export interface PairHostOptions {
  readonly port?: number;
  readonly token?: string;
  readonly onReady: () => void | Promise<void>;
  readonly onInput: (data: Uint8Array) => void;
  readonly onResize: (role: FrontendRole, columns: number, rows: number) => void;
  readonly onError?: (error: Error) => void;
}

export class PairHost {
  readonly ready: Promise<void>;
  readonly #options: PairHostOptions;
  readonly #token: string;
  readonly #sockets = new Map<FrontendRole, WebSocket>();
  readonly #resolveReady: () => void;
  readonly #rejectReady: (error: Error) => void;
  #server?: WebSocketServer;
  #started = false;
  #closed = false;
  #readySettled = false;

  constructor(options: PairHostOptions) {
    this.#options = options;
    this.#token = options.token ?? randomBytes(16).toString("hex");
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.#resolveReady = resolveReady;
    this.#rejectReady = rejectReady;
  }

  async start(): Promise<{ port: number; token: string }> {
    if (this.#server || this.#closed) throw new Error("Pair host cannot be started twice.");
    const server = new WebSocketServer({
      host: "127.0.0.1",
      port: this.#options.port ?? 4194,
      maxPayload: 2 * 1024 * 1024,
    });
    this.#server = server;
    server.on("connection", (socket, request) => this.#connect(socket, request.url ?? "/"));
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address() as AddressInfo;
    return { port: address.port, token: this.#token };
  }

  send(role: FrontendRole, data: Uint8Array): void {
    const socket = this.#sockets.get(role);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot send to the ${role} frontend before it is connected.`);
    }
    socket.send(data);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (!this.#readySettled) {
      this.#readySettled = true;
      this.#rejectReady(new Error("Pair host closed before both frontends were ready."));
    }
    for (const socket of this.#sockets.values()) socket.close();
    const server = this.#server;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }

  #connect(socket: WebSocket, requestUrl: string): void {
    const url = new URL(requestUrl, "http://127.0.0.1");
    const role = url.searchParams.get("role");
    if (url.searchParams.get("token") !== this.#token || !isRole(role) || this.#sockets.has(role)) {
      socket.close(1008, "Invalid role, token, or duplicate frontend");
      return;
    }
    let hello = false;
    socket.on("message", (data: RawData, isBinary: boolean) => {
      try {
        if (!hello) {
          if (isBinary) throw new Error("Expected a JSON hello message");
          const message = JSON.parse(data.toString());
          if (message.type !== "hello" || message.role !== role) throw new Error("Mismatched hello role");
          assertDimensions(message.columns, message.rows);
          hello = true;
          this.#sockets.set(role, socket);
          socket.send(JSON.stringify({ type: "helloAck", role }));
          if (this.#sockets.size === 2 && !this.#started) {
            this.#started = true;
            Promise.resolve().then(() => this.#options.onReady()).then(() => {
              this.#readySettled = true;
              this.#resolveReady();
            }, (error: unknown) => {
              this.#rejectReady(error instanceof Error ? error : new Error(String(error)));
              this.#error(error);
              void this.close();
            });
          }
          return;
        }
        if (isBinary) {
          if (!this.#started) throw new Error("Input arrived before both frontends were ready");
          if (role !== "protocol") throw new Error("The stock frontend is read-only");
          this.#options.onInput(Array.isArray(data) ? Buffer.concat(data) : Buffer.from(new Uint8Array(data)));
          return;
        }
        const message = JSON.parse(data.toString());
        if (message.type !== "resize") throw new Error("Expected a resize message");
        assertDimensions(message.columns, message.rows);
        this.#options.onResize(role, message.columns, message.rows);
      } catch (error) {
        this.#error(error);
        socket.close(1008, "Invalid frontend message");
      }
    });
    socket.on("close", () => {
      if (this.#sockets.get(role) === socket) this.#sockets.delete(role);
    });
    socket.on("error", error => this.#error(error));
  }

  #error(reason: unknown): void {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    try { this.#options.onError?.(error); } catch {}
  }
}

function isRole(value: string | null): value is FrontendRole {
  return value === "stock" || value === "protocol";
}

function assertDimensions(columns: unknown, rows: unknown): void {
  for (const value of [columns, rows]) {
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1000) {
      throw new Error("Invalid terminal dimensions");
    }
  }
}
