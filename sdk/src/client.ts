import {
  ProtocolStreamDecoder, encodeMessageFrames,
  type DecoderEvent, type Message,
} from "../../protocol/src/index.ts";

type Request = Extract<Message, { kind: "capability.query" | "context.open" | "context.close" }>;
type Response = Extract<Message, { kind: "capability.response" | "context.open.response" | "context.close.response" }>;
type Operation = Extract<Message, { kind: `block.${string}` }>;
type OperationBody = { [K in Operation["kind"]]: Pick<Extract<Operation, { kind: K }>, "kind" | "body"> }[Operation["kind"]];

export interface TuiClientOptions {
  /** Accept this entire byte batch synchronously, preserving order with other writes. */
  readonly write: (bytes: Uint8Array) => void;
  /** Local waiting policy, not a protocol timeout requirement. Defaults to 2000 ms. */
  readonly timeoutMs?: number;
}

export interface TuiContext {
  readonly id: string;
  /** Returns the sent Operation ID, not an acknowledgement from the terminal. */
  append(blockId: string, text: string, lifecycle: "mutable" | "sealed"): string;
  update(blockId: string, text: string): string;
  extend(blockId: string, baseOperationId: string, fragment: string): string;
  replaceSuffix(blockId: string, baseOperationId: string, retain: number, replacement: string): string;
  seal(blockId: string): string;
  close(): Promise<void>;
}

export class ControlTimeoutError extends Error {
  constructor() { super("No matching control response arrived before the local deadline."); }
}

export class ControlResponseError extends Error {
  readonly response: Response;
  constructor(response: Response) {
    super(response.body.outcome === "error" ? response.body.error.code : "Unexpected control response");
    this.response = response;
  }
}

interface Pending {
  readonly expectedKind: Response["kind"];
  readonly contextId?: string;
  readonly resolve: (message: Response) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Experimental single-stream client. The application owns transport and fallback. */
export class TuiClient {
  readonly #write: TuiClientOptions["write"];
  readonly #timeoutMs: number;
  readonly #decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  readonly #pending = new Map<string, Pending>();
  #requestId = 0n;
  #operationId = 0n;
  #frameId = 0;
  #disposed = false;
  #supported = false;
  #negotiating = false;

  constructor(options: TuiClientOptions) {
    this.#write = options.write;
    this.#timeoutMs = options.timeoutMs ?? 2000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 2_147_483_647) {
      throw new Error("timeoutMs must be an integer between 1 and 2147483647.");
    }
  }

  async negotiate(): Promise<boolean> {
    this.#assertLive();
    if (this.#negotiating) throw new Error("Negotiation is already pending.");
    this.#negotiating = true;
    this.#supported = false;
    try {
      const response = await this.#request("capability.query");
      if (response.body.outcome === "error") throw new ControlResponseError(response);
      this.#assertLive();
      this.#supported = response.body.outcome === "supported";
      return this.#supported;
    } catch (error) {
      if (error instanceof ControlTimeoutError) return false;
      throw error;
    } finally { this.#negotiating = false; }
  }

  async openContext(): Promise<TuiContext> {
    this.#assertLive();
    if (!this.#supported) throw new Error("Positive capability confirmation is required.");
    const response = await this.#request("context.open");
    if (response.body.outcome === "error") throw new ControlResponseError(response);
    this.#assertLive();
    if (!("context_id" in response)) throw new Error("Context-open response has no Context ID.");
    return this.#context(response.context_id);
  }

  /** Feed every inbound byte here exactly once. Route ordinary bytes and errors to the application. */
  receive(bytes: Uint8Array): readonly DecoderEvent[] {
    this.#assertLive();
    const events = this.#decoder.push(bytes);
    for (const event of events) {
      if (event.type !== "message") continue;
      const message = event.message;
      if (message.kind !== "capability.response" && message.kind !== "context.open.response" &&
          message.kind !== "context.close.response") continue;
      const pending = this.#pending.get(message.request_id);
      if (!pending || pending.expectedKind !== message.kind ||
          (pending.contextId !== undefined && (!("context_id" in message) || message.context_id !== pending.contextId))) continue;
      this.#pending.delete(message.request_id);
      clearTimeout(pending.timer);
      pending.resolve(message);
    }
    return events;
  }

  /** Ends local decoding and rejects pending requests; it does not send Context-close Messages. */
  finish(): readonly DecoderEvent[] {
    if (this.#disposed) return [];
    const events = this.#decoder.finish();
    this.dispose();
    return events;
  }

  dispose(reason = new Error("Client stream is closed.")): void {
    this.#disposed = true;
    this.#supported = false;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error("Client stream is closed.");
  }

  #send(message: Message): void {
    this.#assertLive();
    // Validate and assemble before writing, so a local schema failure emits no prefix.
    const frames = encodeMessageFrames(message, ++this.#frameId);
    const bytes = new Uint8Array(frames.reduce((size, frame) => size + frame.length, 0));
    let offset = 0;
    for (const frame of frames) { bytes.set(frame, offset); offset += frame.length; }
    try { this.#write(bytes); }
    catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))); throw error; }
  }

  #request(kind: Request["kind"], contextId?: string): Promise<Response> {
    const requestId = String(++this.#requestId);
    const message = { version: 1, kind, request_id: requestId,
      ...(contextId === undefined ? {} : { context_id: contextId }), body: {} } as Request;
    const expectedKind: Response["kind"] = kind === "capability.query" ? "capability.response" : `${kind}.response`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new ControlTimeoutError());
      }, this.#timeoutMs);
      this.#pending.set(requestId, { expectedKind, contextId, resolve, reject, timer });
      try { this.#send(message); }
      catch (error) { clearTimeout(timer); this.#pending.delete(requestId); reject(error); }
    });
  }

  #context(id: string): TuiContext {
    let state: "open" | "closing" | "closed" | "uncertain" = "open";
    const send = (operation: OperationBody): string => {
      this.#assertLive();
      if (state !== "open") throw new Error(`Context handle is ${state}.`);
      if (!this.#supported) throw new Error("Positive capability confirmation is required.");
      const operationId = String(++this.#operationId);
      this.#send({ ...operation, version: 1, context_id: id, operation_id: operationId } as Operation);
      return operationId;
    };
    return Object.freeze({
      id,
      append: (blockId: string, text: string, lifecycle: "mutable" | "sealed") => send({
        kind: "block.append", body: { block_id: blockId, lifecycle, content: { type: "text/plain", data: text } },
      }),
      update: (blockId: string, text: string) => send({
        kind: "block.update", body: { block_id: blockId, content: { type: "text/plain", data: text } },
      }),
      extend: (blockId: string, baseOperationId: string, fragment: string) => send({
        kind: "block.extend", body: { block_id: blockId, base_operation_id: baseOperationId, fragment },
      }),
      replaceSuffix: (blockId: string, baseOperationId: string, retain: number, replacement: string) => send({
        kind: "block.replace_suffix", body: { block_id: blockId, base_operation_id: baseOperationId, retain, replacement },
      }),
      seal: (blockId: string) => send({ kind: "block.seal", body: { block_id: blockId } }),
      close: async () => {
        this.#assertLive();
        if (state !== "open") throw new Error(`Context handle is ${state}.`);
        state = "closing";
        try {
          const response = await this.#request("context.close", id);
          if (response.body.outcome === "error") {
            state = "open";
            throw new ControlResponseError(response);
          }
          state = "closed";
        } catch (error) {
          if (state === "closing") state = "uncertain";
          throw error;
        }
      },
    });
  }
}
