import { SearchAddon } from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";

import type { Operation } from "../../block-model/model.ts";
import { BrowserSelectionHistory } from "../xterm-browser-selection/selection-history.ts";

type AppendOperation = Extract<Operation, { readonly type: "append" }>;
type UpdateOperation = Extract<Operation, { readonly type: "update" }>;

/**
 * A narrow browser fixture for the first complete-Update search scenario.
 * Search invalidation is explicit because the private history mutation does
 * not emit xterm.js's normal write event.
 */
export class BrowserSearchHistory {
  readonly #terminal: Terminal;
  readonly #history: BrowserSelectionHistory;
  #search = new SearchAddon();
  #currentTerm: string | undefined;

  constructor(terminal: Terminal) {
    this.#terminal = terminal;
    this.#history = new BrowserSelectionHistory(terminal);
    terminal.loadAddon(this.#search);
  }

  async append(operation: AppendOperation): Promise<void> {
    await this.#history.apply(operation);
    this.#refresh();
  }

  async update(operation: UpdateOperation): Promise<void> {
    const currentTerm = this.#terminal.hasSelection()
      ? this.#currentTerm
      : undefined;
    await this.#history.apply(operation);
    const matchSurvived = this.#terminal.hasSelection();
    this.#resetSearch();
    if (matchSurvived && currentTerm !== undefined) {
      this.#search.findNext(currentTerm);
    }
    this.#refresh();
  }

  findNext(term: string): boolean {
    const found = this.#search.findNext(term);
    this.#currentTerm = term;
    return found;
  }

  range(id: string): Readonly<{ start: number; lineCount: number }> | undefined {
    return this.#history.range(id);
  }

  dispose(): void {
    this.#search.dispose();
    this.#history.dispose();
  }

  #refresh(): void {
    this.#terminal.refresh(0, this.#terminal.rows - 1);
  }

  #resetSearch(): void {
    this.#search.dispose();
    this.#search = new SearchAddon();
    this.#terminal.loadAddon(this.#search);
  }
}
