import type { Terminal } from "@xterm/xterm";
import type { Block } from "../../block-model/model.ts";
import { projectPlainText, textPosition } from "../../xterm-headless/plain-text.ts";

interface CopyHistory {
  blocks(): readonly Block[];
  range(id: string): Readonly<{ start: number; lineCount: number }> | undefined;
}

/** Restore fully selected Tabs from managed text, never from ordinary spaces. */
export function installPlainTextCopy(
  terminal: Terminal, history: CopyHistory,
): () => void {
  const element = terminal.element;
  if (element === undefined) return () => {};
  const onCopy = (event: ClipboardEvent): void => {
    const selection = terminal.getSelectionPosition();
    if (selection === undefined || !terminal.hasSelection() || !event.clipboardData) {
      return;
    }
    const cols = terminal.cols;
    const start = selection.start.y * cols + selection.start.x;
    const end = selection.end.y * cols + selection.end.x;
    const tabs: { start: number; end: number }[] = [];
    if (terminal.buffer.active === terminal.buffer.normal) {
      for (const block of history.blocks()) {
        const range = history.range(block.id);
        if (range === undefined) continue;
        const projection = projectPlainText(
          block.content, terminal.options.tabStopWidth,
        );
        if (!projection.ascii) continue;
        for (const tab of projection.tabs) {
          const a = textPosition(projection.text, tab.start, cols);
          const b = textPosition(projection.text, tab.end, cols);
          const tabStart = (range.start + a.row) * cols + a.column;
          const tabEnd = (range.start + b.row) * cols + b.column;
          if (tabStart >= start && tabEnd <= end) {
            tabs.push({ start: tabStart, end: tabEnd });
          }
        }
      }
    }
    let copied = terminal.getSelection()
      .replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    if (tabs.length > 0) {
      copied = "";
      for (let row = selection.start.y; row <= selection.end.y; row++) {
        const line = terminal.buffer.active.getLine(row);
        if (line === undefined) break;
        const from = row === selection.start.y ? selection.start.x : 0;
        const to = row === selection.end.y ? selection.end.x : cols;
        // Rows containing Tabs are ASCII in this fixture. Other rows retain
        // xterm's native cell-to-string conversion (including wide glyphs).
        const rowTabs = tabs.filter(
          tab => tab.start < row * cols + to && tab.end > row * cols + from,
        );
        let cursor = from;
        let part = "";
        for (const tab of rowTabs.sort((a, b) => a.start - b.start)) {
          const tabStart = Math.max(from, tab.start - row * cols);
          part += line.translateToString(false, cursor, tabStart);
          if (tab.start >= row * cols + from) part += "\t";
          cursor = Math.min(to, tab.end - row * cols);
        }
        part += line.translateToString(true, cursor, to);
        copied += part;
        if (row < selection.end.y && !terminal.buffer.active.getLine(row + 1)?.isWrapped) {
          copied += "\n";
        }
      }
    }
    event.clipboardData.setData("text/plain", copied);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  element.addEventListener("copy", onCopy, true);
  return () => element.removeEventListener("copy", onCopy, true);
}
