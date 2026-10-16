import { PassThrough } from "node:stream";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import { ProtocolStreamDecoder } from "@tui-protocol/protocol";
import { TerminalProtocolEndpoint, type SessionContextSnapshot } from "@tui-protocol/terminal";
import { XtermProtocolEndpoint } from "../xterm-protocol-endpoint/endpoint.ts";

export class FakeInput extends PassThrough {
  isTTY = true;
  isRaw = false;
  setRawMode(raw: boolean): this {
    this.isRaw = raw;
    return this;
  }
}

export class FakeOutput extends PassThrough {
  isTTY = true;
  columns = 80;
  rows = 24;
}

/**
 * In-process terminal host for the Node integration tests: the child's mixed
 * output stream is split into chrome bytes (recorded verbatim) and OSC 9002
 * frames (applied to a real protocol endpoint); response frames return
 * through the child's stdin, exactly like the browser host's reply path.
 * With `terminal` the endpoint is the xterm composition, so Block content —
 * including styled spans — materializes into a real cell buffer; chrome bytes
 * stay recorded-only, so the buffer carries Blocks alone.
 */
export class FakeHost {
  readonly input = new FakeInput();
  readonly output = new FakeOutput();
  readonly endpoint: TerminalProtocolEndpoint | XtermProtocolEndpoint;
  readonly #decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  readonly #text = new TextDecoder();
  readonly diagnostics: string[] = [];
  readonly messageKinds: string[] = [];
  #chrome = "";

  constructor(options: { supported?: boolean; optionalContentTypes?: readonly "text/styled"[]; terminal?: HeadlessTerminal } = {}) {
    const supported = options.supported ?? true;
    this.endpoint = options.terminal
      ? new XtermProtocolEndpoint(options.terminal, {
        completeBaselineSupported: supported,
        optionalContentTypes: options.optionalContentTypes,
      })
      : new TerminalProtocolEndpoint({
        completeBaselineSupported: supported,
        optionalContentTypes: options.optionalContentTypes,
      });
    this.output.on("data", (chunk: Buffer) => this.receiveFromChild(chunk));
  }

  get chrome(): string {
    return this.#chrome;
  }

  contexts(): readonly SessionContextSnapshot[] {
    return this.endpoint.contexts();
  }

  /** Flushes the xterm adapter's asynchronous writes; a no-op for the plain endpoint. */
  async drain(): Promise<void> {
    if (this.endpoint instanceof XtermProtocolEndpoint) await this.endpoint.drain();
  }

  /** Host-to-child bytes: protocol replies or raw keystrokes, in write order. */
  send(text: string | Uint8Array): void {
    this.input.write(typeof text === "string" ? Buffer.from(text, "utf8") : Buffer.from(text));
  }

  resize(columns: number, rows: number): void {
    this.output.columns = columns;
    this.output.rows = rows;
    this.output.emit("resize");
  }

  private receiveFromChild(chunk: Buffer): void {
    for (const event of this.#decoder.push(chunk)) {
      if (event.type === "ordinary") {
        this.#chrome += this.#text.decode(event.data, { stream: true });
        continue;
      }
      if (event.type === "message") this.messageKinds.push(event.message.kind);
      const result = this.endpoint.acceptDecoded(event);
      for (const diagnostic of result.diagnostics) this.diagnostics.push(diagnostic.reason);
      const frames = result.responseFrames;
      if (frames.length > 0) queueMicrotask(() => {
        for (const frame of frames) this.send(frame);
      });
    }
  }
}
