import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/headless";

import { OSC_NUMBER } from "../../../protocol/src/index.ts";
import type {
  EndpointDiagnostic,
  EndpointResult,
} from "../../../terminal/src/index.ts";
import type { XtermProtocolEndpoint } from "./endpoint.ts";

const textEncoder = new TextEncoder();

export interface XtermProtocolParserAddonOptions {
  readonly onResponseFrame: (frame: Uint8Array) => void;
  readonly onDiagnostic: (diagnostic: EndpointDiagnostic) => void;
}

/**
 * Experimental bridge from xterm.js OSC parsing to the protocol endpoint.
 * xterm.js supplies only completed OSC payloads, not their original
 * terminators or intervening stream events. This is therefore not a complete
 * replacement for the protocol's raw byte-stream framing parser.
 */
export class XtermProtocolParserAddon implements ITerminalAddon {
  readonly #endpoint: XtermProtocolEndpoint;
  readonly #onResponseFrame: (frame: Uint8Array) => void;
  readonly #onDiagnostic: (diagnostic: EndpointDiagnostic) => void;
  #registration: IDisposable | undefined;

  constructor(
    endpoint: XtermProtocolEndpoint,
    options: XtermProtocolParserAddonOptions,
  ) {
    this.#endpoint = endpoint;
    this.#onResponseFrame = options.onResponseFrame;
    this.#onDiagnostic = options.onDiagnostic;
  }

  activate(terminal: Terminal): void {
    if (this.#registration !== undefined) {
      throw new Error("XtermProtocolParserAddon is already active.");
    }

    this.#registration = terminal.parser.registerOscHandler(
      OSC_NUMBER,
      (payload) => {
        this.#dispatch(this.#endpoint.push(reconstructOscFrame(payload)));
        return true;
      },
    );
  }

  async drain(): Promise<void> {
    await this.#endpoint.drain();
  }

  dispose(): void {
    this.#registration?.dispose();
    this.#registration = undefined;
  }

  #dispatch(result: EndpointResult): void {
    for (const diagnostic of result.diagnostics) {
      this.#onDiagnostic(diagnostic);
    }
    for (const frame of result.responseFrames) {
      this.#onResponseFrame(frame);
    }
  }
}

function reconstructOscFrame(payload: string): Uint8Array {
  return textEncoder.encode(`\u001B]${OSC_NUMBER};${payload}\u001B\\`);
}
