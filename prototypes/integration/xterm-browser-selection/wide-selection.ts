import type { Terminal } from "@xterm/xterm";
import type { Block } from "../../block-model/model.ts";
import { fixtureCellWidth } from "../../xterm-headless/plain-text.ts";

interface SelectionHistory {
  blocks(): readonly Block[];
  range(id: string): Readonly<{ start: number; lineCount: number }> | undefined;
}

/** Expand half-ideograph endpoints in managed Blocks, never partial Tabs. */
export function normalizeWideSelection(terminal: Terminal, history: SelectionHistory): void {
  if (terminal.buffer.active !== terminal.buffer.normal) return;
  const selection = terminal.getSelectionPosition();
  if (selection === undefined || !terminal.hasSelection()) return;
  const isInterior = (column: number, row: number): boolean => {
    if (column <= 0 || column >= terminal.cols) return false;
    if (!history.blocks().some(block => {
      const range = history.range(block.id);
      return range !== undefined && row >= range.start && row < range.start + range.lineCount;
    })) return false;
    const line = terminal.buffer.normal.getLine(row);
    const previous = line?.getCell(column - 1);
    return line?.getCell(column)?.getWidth() === 0 &&
      previous?.getWidth() === 2 && fixtureCellWidth(previous.getChars()) === 2;
  };
  const start = selection.start.x - (isInterior(selection.start.x, selection.start.y) ? 1 : 0);
  const end = selection.end.x + (isInterior(selection.end.x, selection.end.y) ? 1 : 0);
  if (start !== selection.start.x || end !== selection.end.x) {
    terminal.select(start, selection.start.y,
      (selection.end.y - selection.start.y) * terminal.cols + end - start);
  }
}
