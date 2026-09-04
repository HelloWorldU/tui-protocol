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

type SelectionEndpointAnchor =
  | {
      readonly kind: "block";
      readonly blockId: string;
      readonly offset: number;
    }
  | {
      readonly kind: "logicalLine";
      readonly offset: number;
      readonly marker: IMarker;
    };

interface EndpointSelectionSnapshot {
  readonly end: SelectionEndpointAnchor;
  readonly start: SelectionEndpointAnchor;
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
    const position = this.#terminal.hasSelection()
      ? this.#selectionSnapshot()
      : undefined;
    const logicalSelection =
      position === undefined
        ? undefined
        : this.#blockLogicalSelectionSnapshot(position);
    const endpointSelection =
      position === undefined || logicalSelection !== undefined
        ? undefined
        : this.#retainedEndpointSelectionSnapshot(position);

    try {
      this.#terminal.resize(cols, rows);

      if (logicalSelection !== undefined) {
        this.#restoreLogicalSelection(logicalSelection);
      } else if (endpointSelection !== undefined) {
        this.#restoreEndpointSelection(endpointSelection);
      } else if (position !== undefined) {
        this.#terminal.clearSelection();
      }
    } finally {
      if (endpointSelection !== undefined) {
        this.#disposeEndpointSelection(endpointSelection);
      }
    }

    this.#terminal.refresh(0, this.#terminal.rows - 1);
  }

  async #renderAccepted(operation: Operation): Promise<void> {
    if (
      (operation.type !== "update" &&
        operation.type !== "extend" &&
        operation.type !== "replaceSuffix") ||
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

    if (operation.type === "extend") {
      if (selectionStart >= targetStart && selectionEnd <= targetEnd) {
        await this.#history.renderAccepted(operation);
        return;
      }
      const endpointSelection = this.#endpointSelectionSnapshot(
        operation.id,
        targetBefore,
        selection,
      );
      if (endpointSelection === undefined) {
        this.#terminal.clearSelection();
        await this.#history.renderAccepted(operation);
        return;
      }
      try {
        await this.#history.renderAccepted(operation);
        this.#restoreEndpointSelection(endpointSelection);
      } finally {
        this.#disposeEndpointSelection(endpointSelection);
      }
      return;
    }

    const intersectsTarget =
      selectionStart < targetEnd && selectionEnd > targetStart;
    if (intersectsTarget) {
      const logicalSelection =
        operation.type === "replaceSuffix"
          ? this.#blockLogicalSelectionSnapshot(selection)
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
      if (
        operation.type === "replaceSuffix" &&
        this.#selectionEndsInRetainedPrefix(
          operation.id,
          targetBefore,
          operation.retain,
          selection,
        )
      ) {
        const endpointSelection = this.#endpointSelectionSnapshot(
          operation.id,
          targetBefore,
          selection,
        );
        if (endpointSelection === undefined) {
          this.#terminal.clearSelection();
          await this.#history.renderAccepted(operation);
          return;
        }
        try {
          await this.#history.renderAccepted(operation);
          this.#restoreEndpointSelection(endpointSelection);
        } finally {
          this.#disposeEndpointSelection(endpointSelection);
        }
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

  #blockLogicalSelectionSnapshot(
    position: SelectionSnapshot,
  ): LogicalSelectionSnapshot | undefined {
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

  #retainedEndpointSelectionSnapshot(
    selection: SelectionSnapshot,
  ): EndpointSelectionSnapshot | undefined {
    const start = this.#selectionEndpointAnchorForAnyBlock(
      selection.column,
      selection.row,
    );
    let end: SelectionEndpointAnchor | undefined;
    try {
      end = this.#selectionEndpointAnchorForAnyBlock(
        selection.endColumn,
        selection.endRow,
      );
    } catch (error) {
      this.#disposeSelectionEndpoint(start);
      throw error;
    }
    if (start === undefined || end === undefined) {
      this.#disposeSelectionEndpoint(start);
      this.#disposeSelectionEndpoint(end);
      return undefined;
    }
    return { start, end };
  }

  #selectionEndpointAnchorForAnyBlock(
    column: number,
    row: number,
  ): SelectionEndpointAnchor | undefined {
    for (const block of this.#history.blocks()) {
      const range = this.#history.range(block.id);
      if (
        range !== undefined &&
        row >= range.start &&
        row < range.start + range.lineCount
      ) {
        return this.#blockSelectionEndpointAnchor(
          block.id,
          range,
          column,
          row,
        );
      }
    }
    return this.#logicalLineSelectionEndpointAnchor(column, row);
  }

  #selectionEndsInRetainedPrefix(
    blockId: string,
    range: Readonly<{ start: number; lineCount: number }>,
    retain: number,
    selection: SelectionSnapshot,
  ): boolean {
    const block = this.#history
      .blocks()
      .find((candidate) => candidate.id === blockId);
    if (
      block === undefined ||
      !/^[\x20-\x7e]*$/.test(block.content) ||
      retain > Array.from(block.content).length
    ) {
      return false;
    }

    const selectionEnd =
      selection.endRow * this.#terminal.cols + selection.endColumn;
    const retainedEnd = range.start * this.#terminal.cols + retain;
    return selectionEnd <= retainedEnd;
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

  #endpointSelectionSnapshot(
    blockId: string,
    range: Readonly<{ start: number; lineCount: number }>,
    selection: SelectionSnapshot,
  ): EndpointSelectionSnapshot | undefined {
    const start = this.#selectionEndpointAnchor(
      blockId,
      range,
      selection.column,
      selection.row,
    );
    let end: SelectionEndpointAnchor | undefined;
    try {
      end = this.#selectionEndpointAnchor(
        blockId,
        range,
        selection.endColumn,
        selection.endRow,
      );
    } catch (error) {
      this.#disposeSelectionEndpoint(start);
      throw error;
    }
    if (start === undefined || end === undefined) {
      this.#disposeSelectionEndpoint(start);
      this.#disposeSelectionEndpoint(end);
      return undefined;
    }
    return { start, end };
  }

  #selectionEndpointAnchor(
    blockId: string,
    range: Readonly<{ start: number; lineCount: number }>,
    column: number,
    row: number,
  ): SelectionEndpointAnchor | undefined {
    const blockAnchor = this.#blockSelectionEndpointAnchor(
      blockId,
      range,
      column,
      row,
    );
    if (blockAnchor !== undefined) {
      return blockAnchor;
    }

    return this.#logicalLineSelectionEndpointAnchor(column, row);
  }

  #blockSelectionEndpointAnchor(
    blockId: string,
    range: Readonly<{ start: number; lineCount: number }>,
    column: number,
    row: number,
  ): SelectionEndpointAnchor | undefined {
    if (row < range.start || row >= range.start + range.lineCount) {
      return undefined;
    }
    const block = this.#history
      .blocks()
      .find((candidate) => candidate.id === blockId);
    const offset = (row - range.start) * this.#terminal.cols + column;
    return block !== undefined &&
      /^[\x20-\x7e]*$/.test(block.content) &&
      offset <= Array.from(block.content).length
      ? { kind: "block", blockId, offset }
      : undefined;
  }

  #logicalLineSelectionEndpointAnchor(
    column: number,
    row: number,
  ): SelectionEndpointAnchor | undefined {
    const buffer = this.#terminal.buffer.active;
    if (
      row < 0 ||
      row >= buffer.length ||
      column < 0 ||
      column > this.#terminal.cols
    ) {
      return undefined;
    }

    let firstRow = row;
    let line = buffer.getLine(firstRow);
    if (line === undefined) {
      return undefined;
    }
    while (firstRow > 0 && line.isWrapped) {
      firstRow -= 1;
      line = buffer.getLine(firstRow);
      if (line === undefined) {
        return undefined;
      }
    }
    if (line.isWrapped || !this.#logicalLineIsPrintableAscii(firstRow)) {
      return undefined;
    }

    const endpointLine = buffer.getLine(row);
    const nextLine = buffer.getLine(row + 1);
    if (endpointLine === undefined) {
      return undefined;
    }
    const endpointLength = endpointLine.translateToString(true).length;
    if (!nextLine?.isWrapped && column > endpointLength) {
      return undefined;
    }

    const cursorRow = buffer.baseY + buffer.cursorY;
    return {
      kind: "logicalLine",
      offset: (row - firstRow) * this.#terminal.cols + column,
      marker: this.#terminal.registerMarker(firstRow - cursorRow),
    };
  }

  #logicalLineIsPrintableAscii(firstRow: number): boolean {
    const buffer = this.#terminal.buffer.active;
    let row = firstRow;
    while (true) {
      const line = buffer.getLine(row);
      if (
        line === undefined ||
        !/^[\x20-\x7e]*$/.test(line.translateToString(true))
      ) {
        return false;
      }
      const nextLine = buffer.getLine(row + 1);
      if (!nextLine?.isWrapped) {
        return true;
      }
      row += 1;
    }
  }

  #restoreEndpointSelection(selection: EndpointSelectionSnapshot): void {
    const start = this.#resolveSelectionEndpoint(selection.start);
    const end = this.#resolveSelectionEndpoint(selection.end);
    if (start === undefined || end === undefined) {
      this.#terminal.clearSelection();
      return;
    }
    const length =
      (end.row - start.row) * this.#terminal.cols +
      end.column -
      start.column;
    if (length <= 0) {
      this.#terminal.clearSelection();
      return;
    }
    this.#terminal.select(start.column, start.row, length);
  }

  #resolveSelectionEndpoint(
    endpoint: SelectionEndpointAnchor,
  ): { readonly column: number; readonly row: number } | undefined {
    if (endpoint.kind === "logicalLine") {
      return this.#resolveLogicalLineSelectionEndpoint(endpoint);
    }
    const range = this.#history.range(endpoint.blockId);
    if (range === undefined) {
      return undefined;
    }
    return {
      column: endpoint.offset % this.#terminal.cols,
      row: range.start + Math.floor(endpoint.offset / this.#terminal.cols),
    };
  }

  #resolveLogicalLineSelectionEndpoint(
    endpoint: Extract<SelectionEndpointAnchor, { readonly kind: "logicalLine" }>,
  ): { readonly column: number; readonly row: number } | undefined {
    if (endpoint.marker.isDisposed) {
      return undefined;
    }

    const buffer = this.#terminal.buffer.active;
    let row = endpoint.marker.line;
    const firstLine = buffer.getLine(row);
    if (
      firstLine === undefined ||
      firstLine.isWrapped ||
      !this.#logicalLineIsPrintableAscii(row)
    ) {
      return undefined;
    }

    let remaining = endpoint.offset;
    while (true) {
      const line = buffer.getLine(row);
      if (line === undefined) {
        return undefined;
      }
      const nextLine = buffer.getLine(row + 1);
      const continues = nextLine?.isWrapped === true;
      if (remaining < this.#terminal.cols) {
        const lineLength = line.translateToString(true).length;
        return continues || remaining <= lineLength
          ? { column: remaining, row }
          : undefined;
      }
      if (remaining === this.#terminal.cols) {
        if (continues) {
          return { column: 0, row: row + 1 };
        }
        return line.translateToString(true).length === this.#terminal.cols
          ? { column: this.#terminal.cols, row }
          : undefined;
      }
      if (!continues) {
        return undefined;
      }
      remaining -= this.#terminal.cols;
      row += 1;
    }
  }

  #disposeEndpointSelection(selection: EndpointSelectionSnapshot): void {
    this.#disposeSelectionEndpoint(selection.start);
    this.#disposeSelectionEndpoint(selection.end);
  }

  #disposeSelectionEndpoint(
    endpoint: SelectionEndpointAnchor | undefined,
  ): void {
    if (endpoint?.kind === "logicalLine") {
      endpoint.marker.dispose();
    }
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
