import type { Terminal } from "@xterm/xterm";
import type { XtermLinesHost } from "./lines-host.ts";

/**
 * Browser copy for the lines host: a selection over managed rows copies the
 * Blocks' logical text (no continuation prefixes, no soft breaks) as
 * text/plain. Selections outside managed rows keep xterm.js's own copy.
 */
export function installLinesCopy(terminal: Terminal, host: XtermLinesHost): () => void {
  const element = terminal.element;
  if (element === undefined) return () => {};
  const onCopy = (event: ClipboardEvent): void => {
    const selection = terminal.getSelectionPosition();
    if (selection === undefined || !terminal.hasSelection() || event.clipboardData === null) return;
    const copied = host.copy(
      { row: selection.start.y, col: selection.start.x },
      { row: selection.end.y, col: selection.end.x },
    );
    if (copied === undefined) return;
    event.clipboardData.setData("text/plain", copied);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // Capture phase, ahead of xterm.js's own copy listener.
  element.addEventListener("copy", onCopy, true);
  return () => element.removeEventListener("copy", onCopy, true);
}

/** Selects the first logical-text match and scrolls it into view; false when absent. */
export function selectMatch(terminal: Terminal, host: XtermLinesHost, term: string): boolean {
  const range = host.findRange(term);
  if (range === undefined) return false;
  const cols = terminal.cols;
  const length = (range.end.row * cols + range.end.col) - (range.start.row * cols + range.start.col);
  terminal.select(range.start.col, range.start.row, length);
  terminal.scrollToLine(Math.max(0, range.start.row - 1));
  return true;
}
