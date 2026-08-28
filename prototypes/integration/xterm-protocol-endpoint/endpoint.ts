import type { IDisposable, Terminal } from "@xterm/headless";

import {
  TerminalProtocolEndpoint,
  type EndpointResult,
} from "../protocol-endpoint/index.ts";
import type { SessionContextSnapshot } from "../../protocol-session/index.ts";
import {
  XtermTerminalAdapter,
  type RenderedBlockRange,
  type XtermBlockHistory,
} from "./adapter.ts";

export interface XtermProtocolEndpointOptions {
  readonly completeBaselineSupported: boolean;
  readonly history?: XtermBlockHistory;
}

/**
 * Experimental composition of the protocol endpoint and the private xterm.js
 * history spike. This is not a stable Terminal integration API.
 */
export class XtermProtocolEndpoint implements IDisposable {
  readonly #endpoint: TerminalProtocolEndpoint;
  readonly #adapter: XtermTerminalAdapter;

  constructor(terminal: Terminal, options: XtermProtocolEndpointOptions) {
    this.#adapter = new XtermTerminalAdapter(terminal, options.history);
    this.#endpoint = new TerminalProtocolEndpoint({
      completeBaselineSupported: options.completeBaselineSupported,
      operationAdapter: this.#adapter,
    });
  }

  push(bytes: Uint8Array): EndpointResult {
    return this.#endpoint.push(bytes);
  }

  finish(): EndpointResult {
    return this.#endpoint.finish();
  }

  async drain(): Promise<void> {
    await this.#adapter.drain();
  }

  context(id: string): SessionContextSnapshot | undefined {
    return this.#endpoint.context(id);
  }

  contexts(): readonly SessionContextSnapshot[] {
    return this.#endpoint.contexts();
  }

  range(contextId: string, blockId: string): RenderedBlockRange | undefined {
    return this.#adapter.range(contextId, blockId);
  }

  dispose(): void {
    this.#adapter.dispose();
  }
}
