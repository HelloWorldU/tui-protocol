import {
  ProtocolStreamDecoder, encodeMessageFrames,
  type ContentSnapshot, type DecoderEvent, type LinesTextLine, type Message, type StyledTextSpan,
} from "@tui-protocol/protocol";

type Request = Extract<Message, { kind: "capability.query" | "context.open" | "context.close" }>;
type Response = Extract<Message, { kind: "capability.response" | "context.open.response" | "context.close.response" }>;
type Operation = Extract<Message, { kind: `block.${string}` }>;
type OperationBody = { [K in Operation["kind"]]: Pick<Extract<Operation, { kind: K }>, "kind" | "body"> }[Operation["kind"]];

/**
 * A content Operation's text: a plain string (text/plain), styled spans
 * (text/styled), or lines with layout attributes (text/lines, experimental,
 * RFC 0003). A non-empty array whose first element has `spans` is lines; an
 * empty array is an empty span list.
 */
export type TextContent = string | readonly StyledTextSpan[] | readonly LinesTextLine[];

function isLines(text: TextContent): text is readonly LinesTextLine[] {
  return typeof text !== "string" && text.length > 0 && "spans" in text[0]!;
}

export interface TuiClientOptions {
  /** Accept this entire byte batch synchronously, preserving order with other writes. */
  readonly write: (bytes: Uint8Array) => void;
  /** Local waiting policy, not a protocol timeout requirement. Defaults to 2000 ms. */
  readonly timeoutMs?: number;
  /** Request ID prefix; defaults to a unique value per client. Empty preserves decimal-only IDs. */
  readonly requestIdPrefix?: string;
}

export interface TuiContext {
  readonly id: string;
  /** Returns the sent Operation ID, not an acknowledgement from the terminal. */
  append(blockId: string, text: TextContent, lifecycle: "mutable" | "sealed"): string;
  update(blockId: string, text: TextContent): string;
  extend(blockId: string, baseOperationId: string, fragment: TextContent): string;
  replaceSuffix(blockId: string, baseOperationId: string, retain: number, replacement: TextContent): string;
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
  readonly #requestIdPrefix: string;
  #requestId = 0n;
  #operationId = 0n;
  #frameId = 0;
  #disposed = false;
  #supported = false;
  #negotiating = false;
  #optionalContentTypes: readonly string[] = [];

  constructor(options: TuiClientOptions) {
    this.#write = options.write;
    this.#requestIdPrefix = options.requestIdPrefix ?? newRequestIdPrefix();
    this.#timeoutMs = options.timeoutMs ?? 2000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 2_147_483_647) {
      throw new Error("timeoutMs must be an integer between 1 and 2147483647.");
    }
  }

  /** Optional content types confirmed by the latest positive capability response; empty without one. */
  get optionalContentTypes(): readonly string[] {
    return this.#optionalContentTypes;
  }

  /** True when the latest positive capability response confirmed text/styled. */
  get supportsStyledContent(): boolean {
    return this.#optionalContentTypes.includes("text/styled");
  }

  /** True when the latest positive capability response confirmed experimental text/lines. */
  get supportsLinesContent(): boolean {
    return this.#optionalContentTypes.includes("text/lines");
  }

  async negotiate(): Promise<boolean> {
    this.#assertLive();
    if (this.#negotiating) throw new Error("Negotiation is already pending.");
    this.#negotiating = true;
    this.#supported = false;
    this.#optionalContentTypes = [];
    try {
      const response = await this.#request("capability.query");
      if (response.body.outcome === "error") throw new ControlResponseError(response);
      this.#assertLive();
      this.#supported = response.body.outcome === "supported";
      if (response.body.outcome === "supported") {
        this.#optionalContentTypes = Object.freeze([...response.body.optional_content_types]);
      }
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
    this.#optionalContentTypes = [];
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
    const requestId = `${this.#requestIdPrefix}${String(++this.#requestId)}`;
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
    const styledSpans = (spans: readonly StyledTextSpan[]): readonly StyledTextSpan[] => {
      if (!this.supportsStyledContent) {
        throw new Error("Styled spans require text/styled, which the capability response did not confirm; " +
          "strip styling and send a plain string instead.");
      }
      return spans;
    };
    const lineData = (lines: readonly LinesTextLine[]): readonly LinesTextLine[] => {
      if (!this.supportsLinesContent) {
        throw new Error("Lines require text/lines, which the capability response did not confirm; " +
          "render at the current width into spans or a plain string instead.");
      }
      return lines;
    };
    const arrayFragment = (text: Exclude<TextContent, string>) =>
      isLines(text) ? lineData(text) : styledSpans(text as readonly StyledTextSpan[]);
    const content = (text: TextContent): ContentSnapshot =>
      typeof text === "string"
        ? { type: "text/plain", data: text }
        : isLines(text)
          ? { type: "text/lines", data: lineData(text) }
          : { type: "text/styled", data: styledSpans(text as readonly StyledTextSpan[]) };
    return Object.freeze({
      id,
      append: (blockId: string, text: TextContent, lifecycle: "mutable" | "sealed") => send({
        kind: "block.append", body: { block_id: blockId, lifecycle, content: content(text) },
      }),
      update: (blockId: string, text: TextContent) => send({
        kind: "block.update", body: { block_id: blockId, content: content(text) },
      }),
      extend: (blockId: string, baseOperationId: string, fragment: TextContent) => send({
        kind: "block.extend",
        body: {
          block_id: blockId, base_operation_id: baseOperationId,
          fragment: typeof fragment === "string" ? fragment : arrayFragment(fragment),
        },
      }),
      replaceSuffix: (blockId: string, baseOperationId: string, retain: number, replacement: TextContent) => send({
        kind: "block.replace_suffix",
        body: {
          block_id: blockId, base_operation_id: baseOperationId, retain,
          replacement: typeof replacement === "string" ? replacement : arrayFragment(replacement),
        },
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

function newRequestIdPrefix(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid !== undefined) return `${uuid}:`;
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}:`;
}
