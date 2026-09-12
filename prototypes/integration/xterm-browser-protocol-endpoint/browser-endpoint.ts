import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { Terminal } from "@xterm/xterm";

import type { SessionContextSnapshot } from "@tui-protocol/terminal";
import type { EndpointResult } from "@tui-protocol/terminal";
import { BrowserSearchHistory } from "../xterm-browser-search/search-history.ts";
import {
  XtermProtocolEndpoint,
  type RenderedBlockRange,
} from "../xterm-protocol-endpoint/index.ts";

/**
 * Experimental browser composition of the OSC endpoint, Session, mutable
 * xterm history, selection mapping, and search cache restoration.
 */
export class BrowserXtermProtocolEndpoint {
  readonly #endpoint: XtermProtocolEndpoint;
  readonly #history: BrowserSearchHistory;

  constructor(terminal: Terminal) {
    this.#history = new BrowserSearchHistory(terminal);
    this.#endpoint = new XtermProtocolEndpoint(
      terminal as unknown as HeadlessTerminal,
      {
        completeBaselineSupported: true,
        history: this.#history,
      },
    );
  }

  push(bytes: Uint8Array): EndpointResult {
    return this.#endpoint.push(bytes);
  }

  finish(): EndpointResult {
    return this.#endpoint.finish();
  }

  async drain(): Promise<void> {
    await this.#endpoint.drain();
  }

  context(id: string): SessionContextSnapshot | undefined {
    return this.#endpoint.context(id);
  }

  range(contextId: string, blockId: string): RenderedBlockRange | undefined {
    return this.#endpoint.range(contextId, blockId);
  }

  findNext(term: string): boolean {
    return this.#history.findNext(term);
  }

  resize(cols: number, rows: number): void {
    this.#history.resize(cols, rows);
  }

  dispose(): void {
    this.#endpoint.dispose();
  }
}
