import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { Terminal } from "@xterm/xterm";

import type { Operation } from "../../block-model/model.ts";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";

interface SelectionSnapshot {
  readonly column: number;
  readonly row: number;
  readonly length: number;
}

/**
 * A browser-only experiment around the private xterm history renderer. It is
 * deliberately limited to complete Update selection behavior.
 */
export class BrowserSelectionHistory {
  readonly #terminal: Terminal;
  readonly #history: PrivateCoreBlockHistory;

  constructor(terminal: Terminal) {
    this.#terminal = terminal;
    this.#history = new PrivateCoreBlockHistory(
      terminal as unknown as HeadlessTerminal,
    );
  }

  async apply(operation: Operation): Promise<void> {
    await this.#apply(operation);
    this.#terminal.refresh(0, this.#terminal.rows - 1);
  }

  async #apply(operation: Operation): Promise<void> {
    if (operation.type !== "update" || !this.#terminal.hasSelection()) {
      await this.#history.apply(operation);
      return;
    }

    const targetBefore = this.#history.range(operation.id);
    const selection = this.#selectionSnapshot();
    if (targetBefore === undefined || selection === undefined) {
      await this.#history.apply(operation);
      return;
    }

    const selectionStart =
      selection.row * this.#terminal.cols + selection.column;
    const selectionEnd = selectionStart + selection.length;
    const targetStart = targetBefore.start * this.#terminal.cols;
    const targetEnd =
      (targetBefore.start + targetBefore.lineCount) * this.#terminal.cols;

    if (selectionStart < targetEnd && selectionEnd > targetStart) {
      this.#terminal.clearSelection();
      await this.#history.apply(operation);
      return;
    }

    await this.#history.apply(operation);
    const targetAfter = this.#history.range(operation.id);
    if (targetAfter === undefined) {
      this.#terminal.clearSelection();
      return;
    }

    const rowDelta = targetAfter.lineCount - targetBefore.lineCount;
    const row = selectionStart >= targetEnd
      ? selection.row + rowDelta
      : selection.row;
    this.#terminal.select(selection.column, row, selection.length);
  }

  range(id: string): Readonly<{ start: number; lineCount: number }> | undefined {
    return this.#history.range(id);
  }

  dispose(): void {
    this.#history.dispose();
  }

  #selectionSnapshot(): SelectionSnapshot | undefined {
    const position = this.#terminal.getSelectionPosition();
    if (position === undefined) {
      return undefined;
    }
    const start = position.start.y * this.#terminal.cols + position.start.x;
    const end = position.end.y * this.#terminal.cols + position.end.x;
    return {
      column: position.start.x,
      row: position.start.y,
      length: end - start,
    };
  }
}
