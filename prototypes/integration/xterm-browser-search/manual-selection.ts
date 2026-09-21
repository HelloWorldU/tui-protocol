import { Terminal } from "@xterm/xterm";
import { BrowserSearchHistory } from "./search-history.ts";

/** A later manual selection must not be reclaimed by an earlier search. */
export async function manualSelectionAfterSearch(change: "resize" | "update") {
  const element = document.createElement("div");
  element.className = "isolated-terminal";
  document.body.append(element);
  const terminal = new Terminal({ cols: 20, rows: 4, scrollback: 100 });
  terminal.open(element);
  const history = new BrowserSearchHistory(terminal);
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  try {
    await history.apply({ type: "append", block: { id: "earlier", lifecycle: "mutable", content: "earlier" } });
    await history.apply({ type: "append", block: { id: "reader", lifecycle: "sealed", content: "reader needle" } });
    await history.apply({ type: "append", block: { id: "tail", lifecycle: "sealed", content: "tail\n".repeat(12) } });
    assert(history.findNext("needle"), "Expected initial search result");
    terminal.select(0, history.range("reader")!.start, 6);
    assert(terminal.getSelection() === "reader", "Expected later manual selection");
    if (change === "resize") history.resize(10, 4);
    else await history.apply({ type: "update", id: "earlier", content: "earlier grows\nsecond row\nthird row" });
    assert(terminal.getSelection() === "reader", `Old search replaced the manual selection after ${change}`);
    assert(terminal.getSelectionPosition()?.start.y === history.range("reader")!.start, "Manual selection did not move with its Block");
    let copied: string | undefined;
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData(format: string, value: string) { if (format === "text/plain") copied = value; } } });
    terminal.element!.dispatchEvent(event);
    assert(copied === "reader", "Copy must use the later manual selection");
    assert(history.findNext("needle"), "Explicit search must still work after manual selection");
    return { name: `Manual Selection After Search: ${change}`, detail: "the later selection and copy survived without jumping back to the previous search result" };
  } finally { history.dispose(); terminal.dispose(); element.remove(); }
}
