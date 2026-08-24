import { SearchAddon } from "@xterm/addon-search";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { Terminal } from "@xterm/xterm";

import type { Operation } from "../../block-model/model.ts";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";

type AppendOperation = Extract<Operation, { readonly type: "append" }>;
type UpdateOperation = Extract<Operation, { readonly type: "update" }>;

/**
 * A narrow browser fixture for the first complete-Update search scenario.
 * Search invalidation is explicit because the private history mutation does
 * not emit xterm.js's normal write event.
 */
export class BrowserSearchHistory {
  readonly #terminal: Terminal;
  readonly #history: PrivateCoreBlockHistory;
  #search = new SearchAddon();

  constructor(terminal: Terminal) {
    this.#terminal = terminal;
    this.#history = new PrivateCoreBlockHistory(
      terminal as unknown as HeadlessTerminal,
    );
    terminal.loadAddon(this.#search);
  }

  async append(operation: AppendOperation): Promise<void> {
    await this.#history.apply(operation);
    this.#refresh();
  }

  async update(operation: UpdateOperation): Promise<void> {
    this.#search.clearDecorations();
    this.#terminal.clearSelection();
    await this.#history.apply(operation);
    this.#search.dispose();
    this.#search = new SearchAddon();
    this.#terminal.loadAddon(this.#search);
    this.#refresh();
  }

  findNext(term: string): boolean {
    return this.#search.findNext(term);
  }

  dispose(): void {
    this.#search.dispose();
    this.#history.dispose();
  }

  #refresh(): void {
    this.#terminal.refresh(0, this.#terminal.rows - 1);
  }
}
