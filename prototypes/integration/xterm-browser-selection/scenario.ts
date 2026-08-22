import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { BrowserSelectionHistory } from "./selection-history.ts";
import "./style.css";

interface ScenarioResult {
  readonly name: string;
  readonly detail: string;
}

const terminalElement = requiredElement("terminal");
const summaryElement = requiredElement("summary");
const resultsElement = requiredElement("results");

const terminal = new Terminal({
  cols: 20,
  rows: 4,
  scrollback: 100,
  disableStdin: true,
});
terminal.open(terminalElement);
const history = new BrowserSelectionHistory(terminal);

try {
  const results = await runScenarios();
  summaryElement.textContent = `${results.length} browser selection scenarios passed.`;
  summaryElement.dataset.status = "passed";
  for (const result of results) {
    const item = document.createElement("li");
    item.textContent = `${result.name}: ${result.detail}`;
    item.dataset.status = "passed";
    resultsElement.appendChild(item);
  }
} catch (error) {
  summaryElement.textContent = `Scenario failed: ${errorMessage(error)}`;
  summaryElement.dataset.status = "failed";
  throw error;
}

async function runScenarios(): Promise<ScenarioResult[]> {
  await history.apply({
    type: "append",
    block: { id: "earlier", lifecycle: "mutable", content: "early" },
  });
  await history.apply({
    type: "append",
    block: {
      id: "selected",
      lifecycle: "mutable",
      content: "selected-copy",
    },
  });
  await history.apply({
    type: "append",
    block: { id: "tail", lifecycle: "sealed", content: "tail" },
  });

  const selectedBefore = requiredRange("selected");
  terminal.select(0, selectedBefore.start, "selected-copy".length);
  assertEqual(terminal.getSelection(), "selected-copy", "initial selection");
  assertEqual(copySelection(), "selected-copy", "initial copy event");

  await history.apply({
    type: "update",
    id: "earlier",
    content: "early-one\nearly-two\nearly-three",
  });

  const selectedAfter = requiredRange("selected");
  const movedPosition = terminal.getSelectionPosition();
  assertEqual(terminal.getSelection(), "selected-copy", "preserved selection");
  assertEqual(copySelection(), "selected-copy", "preserved copy event");
  assertEqual(
    movedPosition?.start.y,
    selectedAfter.start,
    "selection row after earlier Block growth",
  );

  const preserved: ScenarioResult = {
    name: "Earlier Block Update",
    detail: "the selected text moved with its Block and copied unchanged",
  };

  await history.apply({
    type: "update",
    id: "selected",
    content: "replacement",
  });

  assertEqual(terminal.hasSelection(), false, "selection after target Update");
  assertEqual(terminal.getSelection(), "", "copy source after target Update");
  assertEqual(copySelection(), undefined, "copy event after target Update");

  await history.apply({
    type: "append",
    block: {
      id: "suffix",
      lifecycle: "mutable",
      content: "alpha-beta",
    },
  });

  const suffixRange = requiredRange("suffix");
  terminal.select(0, suffixRange.start, "alpha".length);
  await history.apply({
    type: "replaceSuffix",
    id: "suffix",
    retain: "alpha".length,
    replacement: "-new",
  });
  assertEqual(
    terminal.getSelection(),
    "alpha",
    "selection inside retained prefix",
  );
  assertEqual(copySelection(), "alpha", "retained-prefix copy event");

  terminal.select("alpha-".length, suffixRange.start, "new".length);
  await history.apply({
    type: "replaceSuffix",
    id: "suffix",
    retain: "alpha".length,
    replacement: "-next",
  });
  assertEqual(
    terminal.hasSelection(),
    false,
    "selection inside removed suffix",
  );
  assertEqual(copySelection(), undefined, "removed-suffix copy event");

  terminal.select(3, suffixRange.start, 5);
  await history.apply({
    type: "replaceSuffix",
    id: "suffix",
    retain: "alpha".length,
    replacement: "-last",
  });
  assertEqual(
    terminal.hasSelection(),
    false,
    "selection crossing retained-prefix boundary",
  );
  assertEqual(copySelection(), undefined, "cross-boundary copy event");

  return [
    preserved,
    {
      name: "Selected Block Update",
      detail: "the selection and copy source were cleared",
    },
    {
      name: "ReplaceSuffix Retained Prefix",
      detail: "the prefix selection and copied text remained unchanged",
    },
    {
      name: "ReplaceSuffix Removed Suffix",
      detail: "a suffix selection and its copy source were cleared",
    },
    {
      name: "ReplaceSuffix Boundary",
      detail: "a selection crossing the replacement boundary was cleared",
    },
  ];
}

function copySelection(): string | undefined {
  let copied: string | undefined;
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData(type: string, value: string): void {
        if (type === "text/plain") {
          copied = value;
        }
      },
    },
  });
  terminal.element?.dispatchEvent(event);
  return copied;
}

function requiredRange(id: string): Readonly<{ start: number; lineCount: number }> {
  const range = history.range(id);
  if (range === undefined) {
    throw new Error(`Block ${JSON.stringify(id)} has no rendered range.`);
  }
  return range;
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
