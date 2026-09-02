import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { IMarker, Terminal } from "@xterm/xterm";

import type { Operation } from "../../block-model/model.ts";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";

interface SelectionSnapshot {
  readonly column: number;
  readonly endColumn: number;
  readonly endRow: number;
  readonly row: number;
  readonly length: number;
}

interface MarkerSelectionSnapshot {
  readonly endColumn: number;
  readonly endMarker: IMarker;
  readonly startColumn: number;
  readonly startMarker: IMarker;
}

interface LogicalSelectionSnapshot {
  readonly blockId: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

/**
 * A browser-only experiment around the private xterm history renderer. It is
 * deliberately limited to the tested printable-ASCII selection behavior.
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
    await this.#renderAccepted(operation);
    this.#terminal.refresh(0, this.#terminal.rows - 1);
  }

  resize(cols: number, rows: number): void {
    const selection = this.#terminal.hasSelection()
      ? this.#logicalSelectionSnapshot()
      : undefined;

    this.#terminal.resize(cols, rows);

    if (selection !== undefined) {
      const range = this.#history.range(selection.blockId);
      if (range === undefined) {
        this.#terminal.clearSelection();
      } else {
        const rowOffset = Math.floor(selection.startOffset / cols);
        const column = selection.startOffset % cols;
        this.#terminal.select(
          column,
          range.start + rowOffset,
          selection.endOffset - selection.startOffset,
        );
      }
    }

    this.#terminal.refresh(0, this.#terminal.rows - 1);
  }

  async #renderAccepted(operation: Operation): Promise<void> {
    if (
      (operation.type !== "update" && operation.type !== "replaceSuffix") ||
      !this.#terminal.hasSelection()
    ) {
      await this.#history.renderAccepted(operation);
      return;
    }

    const targetBefore = this.#history.range(operation.id);
    const selection = this.#selectionSnapshot();
    if (targetBefore === undefined || selection === undefined) {
      await this.#history.renderAccepted(operation);
      return;
    }
    const selectionStart =
      selection.row * this.#terminal.cols + selection.column;
    const selectionEnd = selectionStart + selection.length;
    const targetStart = targetBefore.start * this.#terminal.cols;
    const targetEnd =
      (targetBefore.start + targetBefore.lineCount) * this.#terminal.cols;

    const intersectsTarget =
      selectionStart < targetEnd && selectionEnd > targetStart;
    if (intersectsTarget) {
      const logicalSelection =
        operation.type === "replaceSuffix"
          ? this.#blockLogicalSelectionSnapshot()
          : undefined;
      if (
        operation.type === "replaceSuffix" &&
        logicalSelection?.blockId === operation.id &&
        logicalSelection.endOffset <= operation.retain
      ) {
        await this.#history.renderAccepted(operation);
        this.#restoreLogicalSelection(logicalSelection);
        return;
      }

      this.#terminal.clearSelection();
      await this.#history.renderAccepted(operation);
      return;
    }

    const markerSelection = this.#markerSelectionSnapshot(selection);
    try {
      await this.#history.renderAccepted(operation);
      this.#restoreMarkerSelection(markerSelection);
    } finally {
      markerSelection.startMarker.dispose();
      markerSelection.endMarker.dispose();
    }
  }

  range(id: string): Readonly<{ start: number; lineCount: number }> | undefined {
    return this.#history.range(id);
  }

  retire(id: string): void {
    this.#history.retire(id);
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
      endColumn: position.end.x,
      endRow: position.end.y,
      row: position.start.y,
      length: end - start,
    };
  }

  #logicalSelectionSnapshot(): LogicalSelectionSnapshot {
    const selection = this.#blockLogicalSelectionSnapshot();
    if (selection !== undefined) {
      return selection;
    }

    throw new Error(
      "Resize selection mapping requires one selection inside one retained Block.",
    );
  }

  #blockLogicalSelectionSnapshot(): LogicalSelectionSnapshot | undefined {
    const position = this.#selectionSnapshot();
    if (position === undefined) {
      throw new Error("The terminal reported a selection without coordinates.");
    }
    const selectionStart =
      position.row * this.#terminal.cols + position.column;
    const selectionEnd = selectionStart + position.length;

    for (const block of this.#history.blocks()) {
      const range = this.#history.range(block.id);
      if (range === undefined) {
        continue;
      }
      const rangeStart = range.start * this.#terminal.cols;
      const startOffset = selectionStart - rangeStart;
      const endOffset = selectionEnd - rangeStart;
      if (
        startOffset < 0 ||
        endOffset > range.lineCount * this.#terminal.cols
      ) {
        continue;
      }
      if (
        !/^[\x20-\x7e]*$/.test(block.content) ||
        endOffset > Array.from(block.content).length
      ) {
        throw new Error(
          "Resize selection mapping is limited to one logical ASCII line.",
        );
      }
      return { blockId: block.id, startOffset, endOffset };
    }

    return undefined;
  }

  #markerSelectionSnapshot(
    selection: SelectionSnapshot,
  ): MarkerSelectionSnapshot {
    const buffer = this.#terminal.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;
    return {
      startColumn: selection.column,
      startMarker: this.#terminal.registerMarker(selection.row - cursorRow),
      endColumn: selection.endColumn,
      endMarker: this.#terminal.registerMarker(selection.endRow - cursorRow),
    };
  }

  #restoreMarkerSelection(selection: MarkerSelectionSnapshot): void {
    if (selection.startMarker.isDisposed || selection.endMarker.isDisposed) {
      this.#terminal.clearSelection();
      return;
    }
    const length =
      (selection.endMarker.line - selection.startMarker.line) *
        this.#terminal.cols +
      selection.endColumn -
      selection.startColumn;
    if (length <= 0) {
      this.#terminal.clearSelection();
      return;
    }
    this.#terminal.select(
      selection.startColumn,
      selection.startMarker.line,
      length,
    );
  }

  #restoreLogicalSelection(selection: LogicalSelectionSnapshot): void {
    const range = this.#history.range(selection.blockId);
    if (range === undefined) {
      this.#terminal.clearSelection();
      return;
    }
    const rowOffset = Math.floor(
      selection.startOffset / this.#terminal.cols,
    );
    const column = selection.startOffset % this.#terminal.cols;
    this.#terminal.select(
      column,
      range.start + rowOffset,
      selection.endOffset - selection.startOffset,
    );
  }
}
