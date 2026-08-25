import { SearchAddon } from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";

import type { Operation } from "../../block-model/model.ts";
import { BrowserSelectionHistory } from "../xterm-browser-selection/selection-history.ts";

/**
 * A narrow browser fixture for current-projection search scenarios.
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

  async apply(operation: Operation): Promise<void> {
    const currentTerm = this.#selectedSearchTerm();
    await this.#history.apply(operation);
    this.#restoreSearch(currentTerm);
  }

  resize(cols: number, rows: number): void {
    const currentTerm = this.#selectedSearchTerm();
    this.#history.resize(cols, rows);
    this.#restoreSearch(currentTerm);
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

  #restoreSearch(currentTerm: string | undefined): void {
    const matchSurvived = this.#terminal.hasSelection();
    this.#resetSearch();
    if (matchSurvived && currentTerm !== undefined) {
      this.#search.findNext(currentTerm);
    }
    this.#refresh();
  }

  #selectedSearchTerm(): string | undefined {
    return this.#terminal.hasSelection() ? this.#currentTerm : undefined;
  }
}
