import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { BrowserSearchHistory } from "./search-history.ts";
import "./style.css";

const terminal = new Terminal({
  cols: 20,
  rows: 4,
  scrollback: 100,
  disableStdin: true,
});
terminal.open(requiredElement("terminal"));
const history = new BrowserSearchHistory(terminal);

try {
  await history.append({
    type: "append",
    block: {
      id: "search-target",
      lifecycle: "mutable",
      content: "obsolete marker",
    },
  });

  assertEqual(history.findNext("obsolete"), true, "initial old-text search");
  assertEqual(terminal.getSelection(), "obsolete", "initial current match");

  await history.update({
    type: "update",
    id: "search-target",
    content: "fresh marker",
  });

  assertEqual(
    terminal.hasSelection(),
    false,
    "current match after its text is replaced",
  );
  assertEqual(
    history.findNext("obsolete"),
    false,
    "old-text search after Update",
  );
  assertEqual(
    history.findNext("fresh"),
    true,
    "replacement-text search after Update",
  );
  assertEqual(terminal.getSelection(), "fresh", "replacement current match");

  reportPassed(
    "Selected Block Update",
    "the old match disappeared and replacement text became searchable",
  );
} catch (error) {
  const summary = requiredElement("summary");
  summary.textContent = `Scenario failed: ${errorMessage(error)}`;
  summary.dataset.status = "failed";
  throw error;
}

function reportPassed(name: string, detail: string): void {
  const summary = requiredElement("summary");
  summary.textContent = "1 browser search scenario passed.";
  summary.dataset.status = "passed";

  const item = document.createElement("li");
  item.textContent = `${name}: ${detail}`;
  item.dataset.status = "passed";
  requiredElement("results").appendChild(item);
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Element ${JSON.stringify(id)} is missing.`);
  }
  return element;
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
