import { SearchAddon } from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";

import type { Operation } from "../../block-model/model.ts";
import { BrowserSelectionHistory } from "../xterm-browser-selection/selection-history.ts";
import { installSearchCellOffsetFixture } from "./search-cell-offset.ts";

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
  #currentMatch: string | undefined;

  constructor(terminal: Terminal) {
    this.#terminal = terminal;
    this.#history = new BrowserSelectionHistory(terminal);
    terminal.loadAddon(this.#search);
    installSearchCellOffsetFixture(this.#search, terminal);
  }

  async apply(operation: Operation): Promise<void> {
    this.accept(operation);
    await this.renderAccepted(operation);
  }

  wouldExceedCapacity(operation: Operation): boolean {
    return this.#history.wouldExceedCapacity(operation);
  }

  accept(operation: Operation): void {
    this.#history.accept(operation);
  }

  async renderAccepted(operation: Operation): Promise<void> {
    const currentTerm = this.#selectedSearchTerm();
    await this.#history.renderAccepted(operation);
    this.#restoreSearch(currentTerm);
  }

  resize(cols: number, rows: number): void {
    const currentTerm = this.#selectedSearchTerm();
    this.#history.resize(cols, rows);
    this.#restoreSearch(currentTerm);
  }

  findNext(term: string): boolean {
    const found = this.#search.findNext(term);
    this.#currentTerm = found ? term : undefined;
    this.#currentMatch = found ? this.#selectionKey() : undefined;
    return found;
  }

  range(id: string): Readonly<{ start: number; lineCount: number }> | undefined {
    return this.#history.range(id);
  }

  retire(id: string): void {
    this.#history.retire(id);
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
    installSearchCellOffsetFixture(this.#search, this.#terminal);
  }

  #restoreSearch(currentTerm: string | undefined): void {
    const matchSurvived = this.#terminal.hasSelection();
    this.#resetSearch();
    if (matchSurvived && currentTerm !== undefined) {
      this.findNext(currentTerm);
    } else {
      this.#currentTerm = undefined;
      this.#currentMatch = undefined;
    }
    this.#refresh();
  }

  #selectedSearchTerm(): string | undefined {
    // A user selection made since findNext is not owned by the old search.
    return this.#currentMatch !== undefined && this.#selectionKey() === this.#currentMatch
      ? this.#currentTerm : undefined;
  }

  #selectionKey(): string | undefined {
    const position = this.#terminal.getSelectionPosition();
    if (!position || !this.#terminal.hasSelection()) return undefined;
    return JSON.stringify({ position, text: this.#terminal.getSelection() });
  }
}
