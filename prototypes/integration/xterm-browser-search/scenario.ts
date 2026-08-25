import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { BrowserSearchHistory } from "./search-history.ts";
import "./style.css";

interface ScenarioResult {
  readonly name: string;
  readonly detail: string;
}

const terminal = new Terminal({
  cols: 20,
  rows: 4,
  scrollback: 100,
  disableStdin: true,
});
terminal.open(requiredElement("terminal"));
const history = new BrowserSearchHistory(terminal);

try {
  const results = [
    await runSelectedBlockUpdateScenario(),
    await runEarlierBlockUpdateScenario(),
  ];
  reportPassed(results);
} catch (error) {
  const summary = requiredElement("summary");
  summary.textContent = `Scenario failed: ${errorMessage(error)}`;
  summary.dataset.status = "failed";
  throw error;
}

async function runSelectedBlockUpdateScenario(): Promise<ScenarioResult> {
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

  return {
    name: "Selected Block Update",
    detail: "the old match disappeared and replacement text became searchable",
  };
}

async function runEarlierBlockUpdateScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture();
  try {
    await fixture.history.append({
      type: "append",
      block: {
        id: "earlier-search",
        lifecycle: "mutable",
        content: "early",
      },
    });
    await fixture.history.append({
      type: "append",
      block: {
        id: "unaffected-match",
        lifecycle: "sealed",
        content: "persistent match",
      },
    });
    const rangeBefore = requiredRange("unaffected-match", fixture.history);

    assertEqual(
      fixture.history.findNext("persistent"),
      true,
      "initial unaffected-match search",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "persistent",
      "initial unaffected current match",
    );

    await fixture.history.update({
      type: "update",
      id: "earlier-search",
      content: "early-one\nearly-two\nearly-three",
    });

    const rangeAfter = requiredRange("unaffected-match", fixture.history);
    assertEqual(
      rangeAfter.start > rangeBefore.start,
      true,
      "unaffected Block moved after earlier Block growth",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "persistent",
      "current match after earlier Block growth",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      rangeAfter.start,
      "current match row after earlier Block growth",
    );

    return {
      name: "Earlier Block Update",
      detail: "the later current match moved with its unchanged Block",
    };
  } finally {
    fixture.dispose();
  }
}

function createIsolatedFixture(): {
  readonly terminal: Terminal;
  readonly history: BrowserSearchHistory;
  dispose(): void;
} {
  const host = document.createElement("div");
  host.className = "isolated-terminal";
  document.body.appendChild(host);
  const isolatedTerminal = new Terminal({
    cols: 20,
    rows: 4,
    scrollback: 100,
    disableStdin: true,
  });
  isolatedTerminal.open(host);
  const isolatedHistory = new BrowserSearchHistory(isolatedTerminal);
  return {
    terminal: isolatedTerminal,
    history: isolatedHistory,
    dispose(): void {
      isolatedHistory.dispose();
      isolatedTerminal.dispose();
      host.remove();
    },
  };
}

function requiredRange(
  id: string,
  source: BrowserSearchHistory,
): Readonly<{ start: number; lineCount: number }> {
  const range = source.range(id);
  if (range === undefined) {
    throw new Error(`Block ${JSON.stringify(id)} has no rendered range.`);
  }
  return range;
}

function reportPassed(results: readonly ScenarioResult[]): void {
  const summary = requiredElement("summary");
  summary.textContent = `${results.length} browser search scenarios passed.`;
  summary.dataset.status = "passed";

  for (const result of results) {
    const item = document.createElement("li");
    item.textContent = `${result.name}: ${result.detail}`;
    item.dataset.status = "passed";
    requiredElement("results").appendChild(item);
  }
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
