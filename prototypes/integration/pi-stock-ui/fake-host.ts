import { PassThrough } from "node:stream";
import { ProtocolStreamDecoder } from "@tui-protocol/protocol";
import { TerminalProtocolEndpoint, type SessionContextSnapshot } from "@tui-protocol/terminal";

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
 * frames (applied to a real TerminalProtocolEndpoint); response frames return
 * through the child's stdin, exactly like the browser host's reply path.
 */
export class FakeHost {
  readonly input = new FakeInput();
  readonly output = new FakeOutput();
  readonly endpoint: TerminalProtocolEndpoint;
  readonly #decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  readonly #text = new TextDecoder();
  readonly diagnostics: string[] = [];
  readonly messageKinds: string[] = [];
  #chrome = "";

  constructor(options: { supported?: boolean } = {}) {
    this.endpoint = new TerminalProtocolEndpoint({ completeBaselineSupported: options.supported ?? true });
    this.output.on("data", (chunk: Buffer) => this.receiveFromChild(chunk));
  }

  get chrome(): string {
    return this.#chrome;
  }

  contexts(): readonly SessionContextSnapshot[] {
    return this.endpoint.contexts();
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
