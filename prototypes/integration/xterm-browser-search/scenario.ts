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
    await runExtendSearchScenario(),
    await runRetainedPrefixSearchScenario(),
    await runRemovedSuffixSearchScenario(),
    await runAppendAndSealSearchScenario(),
  ];
  reportPassed(results);
} catch (error) {
  const summary = requiredElement("summary");
  summary.textContent = `Scenario failed: ${errorMessage(error)}`;
  summary.dataset.status = "failed";
  throw error;
}

async function runSelectedBlockUpdateScenario(): Promise<ScenarioResult> {
  await history.apply({
    type: "append",
    block: {
      id: "search-target",
      lifecycle: "mutable",
      content: "obsolete marker",
    },
  });

  assertEqual(history.findNext("obsolete"), true, "initial old-text search");
  assertEqual(terminal.getSelection(), "obsolete", "initial current match");

  await history.apply({
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
    await fixture.history.apply({
      type: "append",
      block: {
        id: "earlier-search",
        lifecycle: "mutable",
        content: "early",
      },
    });
    await fixture.history.apply({
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

    await fixture.history.apply({
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

async function runExtendSearchScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture();
  try {
    await fixture.history.apply({
      type: "append",
      block: {
        id: "extend-search",
        lifecycle: "mutable",
        content: "stable",
      },
    });
    assertEqual(
      fixture.history.findNext("stable"),
      true,
      "initial pre-Extend search",
    );

    await fixture.history.apply({
      type: "extend",
      id: "extend-search",
      fragment: " new-token",
    });

    assertEqual(
      fixture.terminal.getSelection(),
      "stable",
      "current match after Extend",
    );
    assertEqual(
      fixture.history.findNext("new-token"),
      true,
      "appended-text search after Extend",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "new-token",
      "appended-text current match",
    );

    return {
      name: "Extend",
      detail: "the old match remained and appended text became searchable",
    };
  } finally {
    fixture.dispose();
  }
}

async function runRetainedPrefixSearchScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture();
  try {
    await fixture.history.apply({
      type: "append",
      block: {
        id: "retained-prefix-search",
        lifecycle: "mutable",
        content: "stable obsolete",
      },
    });
    assertEqual(
      fixture.history.findNext("stable"),
      true,
      "initial retained-prefix search",
    );

    await fixture.history.apply({
      type: "replaceSuffix",
      id: "retained-prefix-search",
      retain: "stable".length,
      replacement: " fresh",
    });

    assertEqual(
      fixture.terminal.getSelection(),
      "stable",
      "retained-prefix match after ReplaceSuffix",
    );
    assertEqual(
      fixture.history.findNext("obsolete"),
      false,
      "removed-text search after ReplaceSuffix",
    );
    assertEqual(
      fixture.history.findNext("fresh"),
      true,
      "replacement-text search after ReplaceSuffix",
    );

    return {
      name: "ReplaceSuffix Retained Prefix",
      detail: "the retained match stayed while old and new suffix results changed",
    };
  } finally {
    fixture.dispose();
  }
}

async function runRemovedSuffixSearchScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture();
  try {
    await fixture.history.apply({
      type: "append",
      block: {
        id: "removed-suffix-search",
        lifecycle: "mutable",
        content: "prefix obsolete",
      },
    });
    assertEqual(
      fixture.history.findNext("obsolete"),
      true,
      "initial removed-suffix search",
    );

    await fixture.history.apply({
      type: "replaceSuffix",
      id: "removed-suffix-search",
      retain: "prefix".length,
      replacement: " fresh",
    });

    assertEqual(
      fixture.terminal.hasSelection(),
      false,
      "current match after its suffix is replaced",
    );
    assertEqual(
      fixture.history.findNext("obsolete"),
      false,
      "removed current-match search after ReplaceSuffix",
    );
    assertEqual(
      fixture.history.findNext("fresh"),
      true,
      "replacement search after current match is removed",
    );

    return {
      name: "ReplaceSuffix Removed Match",
      detail: "the removed current match cleared and replacement text was found",
    };
  } finally {
    fixture.dispose();
  }
}

async function runAppendAndSealSearchScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture();
  try {
    await fixture.history.apply({
      type: "append",
      block: {
        id: "existing-search",
        lifecycle: "sealed",
        content: "stable",
      },
    });
    assertEqual(
      fixture.history.findNext("stable"),
      true,
      "initial pre-Append search",
    );

    await fixture.history.apply({
      type: "append",
      block: {
        id: "appended-search",
        lifecycle: "mutable",
        content: "append-match",
      },
    });

    assertEqual(
      fixture.terminal.getSelection(),
      "stable",
      "existing current match after Append",
    );
    assertEqual(
      fixture.history.findNext("append-match"),
      true,
      "new Block search after Append",
    );

    await fixture.history.apply({
      type: "seal",
      id: "appended-search",
    });

    assertEqual(
      fixture.terminal.getSelection(),
      "append-match",
      "current match after its Block is sealed",
    );

    return {
      name: "Append and Seal",
      detail: "Append added a result and neither Operation lost a valid match",
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
