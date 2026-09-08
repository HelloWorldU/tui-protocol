/**
 * Cell traversal adapted from xterm.js addon-search.
 * Copyright (c) 2017 The xterm.js authors. All rights reserved.
 * Licensed under the MIT License; see the repository LICENSE.
 */
import type { SearchAddon } from "@xterm/addon-search";

interface Cell {
  getCode(): number;
  getChars(): string;
  getWidth(): number;
}

interface Line {
  readonly isWrapped: boolean;
  getCell(index: number): Cell | undefined;
}

interface SearchTerminal {
  readonly cols: number;
  readonly buffer: { readonly active: { getLine(row: number): Line | undefined } };
}

/**
 * Match addon-search's logical-line cache: wide-wrap padding is omitted there,
 * so it must also be omitted when converting a search start from cells to text.
 * Offsets are JS string indices, not protocol ReplaceSuffix scalar positions.
 */
export function searchCellOffset(
  terminal: SearchTerminal, startRow: number, columns: number,
): number {
  let row = startRow;
  let remaining = columns;
  let offset = 0;
  let line = terminal.buffer.active.getLine(row);
  while (remaining > 0 && line !== undefined) {
    const next = terminal.buffer.active.getLine(row + 1);
    for (let column = 0; column < Math.min(remaining, terminal.cols); column++) {
      const cell = line.getCell(column);
      if (cell === undefined) break;
      const isWideWrapPadding = column === terminal.cols - 1 &&
        cell.getCode() === 0 && cell.getWidth() === 1 &&
        next?.isWrapped === true && next.getCell(0)?.getWidth() === 2;
      if (cell.getWidth() !== 0 && !isWideWrapPadding) {
        offset += cell.getCode() === 0 ? 1 : cell.getChars().length;
      }
    }
    remaining -= terminal.cols;
    if (!next?.isWrapped) break;
    row++;
    line = next;
  }
  return offset;
}

/**
 * Private addon-search 0.16.0 workaround. This is not a public integration API.
 * Keep this conversion consistent with SearchLineCache's padding removal.
 */
export function installSearchCellOffsetFixture(
  addon: SearchAddon, terminal: SearchTerminal,
): void {
  const engine = (addon as unknown as {
    _engine?: { _bufferColsToStringOffset?: (row: number, columns: number) => number };
  })._engine;
  if (engine === undefined || typeof engine._bufferColsToStringOffset !== "function") {
    throw new Error("The pinned search addon's cell-offset hook is unavailable.");
  }
  engine._bufferColsToStringOffset = (row, columns) => searchCellOffset(terminal, row, columns);
}
