import type { IDisposable, Terminal } from "@xterm/headless";

import {
  ProtocolStreamDecoder,
  type DecoderEvent,
} from "@tui-protocol/protocol";
import type {
  EndpointDiagnostic,
  EndpointResult,
} from "@tui-protocol/terminal";
import type { XtermProtocolEndpoint } from "./endpoint.ts";

export interface XtermMixedStreamIngressOptions {
  readonly onResponseFrame: (frame: Uint8Array) => void;
  readonly onDiagnostic: (diagnostic: EndpointDiagnostic) => void;
}

/**
 * Experimental raw ingress that orders protocol realization and ordinary
 * xterm.js writes on one queue. It is not a stable Terminal integration API.
 */
export class XtermMixedStreamIngress implements IDisposable {
  readonly #terminal: Terminal;
  readonly #endpoint: XtermProtocolEndpoint;
  readonly #decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  readonly #onResponseFrame: (frame: Uint8Array) => void;
  readonly #onDiagnostic: (diagnostic: EndpointDiagnostic) => void;
  readonly #registrations: IDisposable[];
  #processing: Promise<void> = Promise.resolve();
  #ended = false;

  constructor(
    terminal: Terminal,
    endpoint: XtermProtocolEndpoint,
    options: XtermMixedStreamIngressOptions,
  ) {
    this.#terminal = terminal;
    this.#endpoint = endpoint;
    this.#onResponseFrame = options.onResponseFrame;
    this.#onDiagnostic = options.onDiagnostic;
    this.#registrations = [
      terminal.parser.registerCsiHandler({ final: "K" }, (params) => {
        const mode = firstParameter(params);
        if (mode >= 0 && mode <= 2) {
          this.#invalidateActiveRows(currentRow(terminal), 1);
        }
        return false;
      }),
      terminal.parser.registerCsiHandler({ final: "J" }, (params) => {
        const mode = firstParameter(params);
        const buffer = terminal.buffer.active;
        if (
          buffer.type === "normal" &&
          mode === 2 &&
          !terminal.options.scrollOnEraseInDisplay
        ) {
          this.#invalidateActiveRows(buffer.baseY, terminal.rows);
        } else if (buffer.type === "normal" && mode === 3) {
          this.#invalidateActiveRows(
            0,
            Math.max(0, buffer.length - terminal.rows),
          );
        }
        return false;
      }),
      terminal.parser.registerEscHandler({ final: "c" }, () => {
        const normal = terminal.buffer.normal;
        if (normal.length > 0) {
          this.#endpoint.invalidateContextsIntersectingRows(0, normal.length);
        }
        return false;
      }),
    ];
  }

  push(bytes: Uint8Array): Promise<void> {
    if (this.#ended) {
      throw new Error("Mixed-stream ingress cannot receive bytes after finish.");
    }
    const owned = bytes.slice();
    const task = this.#processing.then(async () => {
      await this.#consume(this.#decoder.push(owned));
    });
    this.#processing = task;
    return task;
  }

  finish(): Promise<void> {
    if (this.#ended) {
      return this.#processing;
    }
    this.#ended = true;
    const task = this.#processing.then(async () => {
      await this.#consume(this.#decoder.finish());
      this.#dispatch(this.#endpoint.finish());
      await this.#endpoint.drain();
    });
    this.#processing = task;
    return task;
  }

  async drain(): Promise<void> {
    await this.#processing;
    await this.#endpoint.drain();
  }

  dispose(): void {
    for (const registration of this.#registrations.splice(0)) {
      registration.dispose();
    }
  }

  async #consume(events: readonly DecoderEvent[]): Promise<void> {
    for (const event of events) {
      if (event.type === "ordinary") {
        await write(this.#terminal, event.data);
        continue;
      }
      this.#dispatch(this.#endpoint.acceptDecoded(event));
      await this.#endpoint.drain();
    }
  }

  #dispatch(result: EndpointResult): void {
    for (const diagnostic of result.diagnostics) {
      this.#onDiagnostic(diagnostic);
    }
    for (const frame of result.responseFrames) {
      this.#onResponseFrame(frame);
    }
  }

  #invalidateActiveRows(start: number, lineCount: number): void {
    if (this.#terminal.buffer.active.type !== "normal" || lineCount <= 0) {
      return;
    }
    this.#endpoint.invalidateContextsIntersectingRows(
      start,
      start + lineCount,
    );
  }
}

function firstParameter(params: readonly (number | number[])[]): number {
  const first = params[0];
  return typeof first === "number" ? first : 0;
}

function currentRow(terminal: Terminal): number {
  const buffer = terminal.buffer.active;
  return buffer.baseY + buffer.cursorY;
}

function write(terminal: Terminal, data: Uint8Array): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}
