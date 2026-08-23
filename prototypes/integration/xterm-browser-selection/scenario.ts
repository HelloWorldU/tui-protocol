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

  const selectedBlockReflow = await runSelectedBlockReflowScenario();
  const earlierBlockReflow = await runEarlierBlockReflowScenario();
  const retainedCapacitySelection =
    await runRetainedCapacitySelectionScenario();
  const evictedCapacitySelection =
    await runEvictedCapacitySelectionScenario();

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
    selectedBlockReflow,
    earlierBlockReflow,
    retainedCapacitySelection,
    evictedCapacitySelection,
  ];
}

async function runSelectedBlockReflowScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture();
  try {
    await fixture.history.apply({
      type: "append",
      block: {
        id: "selected-reflow",
        lifecycle: "sealed",
        content: "abc-selected-xyz",
      },
    });
    const range = requiredRange("selected-reflow", fixture.history);
    fixture.terminal.select("abc-".length, range.start, "selected".length);

    fixture.history.resize(10, 4);

    assertEqual(
      fixture.terminal.getSelection(),
      "selected",
      "selection after its Block reflows",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "selected",
      "copy event after its Block reflows",
    );
    return {
      name: "Selected Block Reflow",
      detail: "the same logical text remained selected and copied",
    };
  } finally {
    fixture.dispose();
  }
}

async function runEarlierBlockReflowScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture();
  try {
    await fixture.history.apply({
      type: "append",
      block: {
        id: "earlier-reflow",
        lifecycle: "sealed",
        content: "1234567890ABCDEF",
      },
    });
    await fixture.history.apply({
      type: "append",
      block: {
        id: "later-selection",
        lifecycle: "sealed",
        content: "later-copy",
      },
    });
    const rangeBefore = requiredRange("later-selection", fixture.history);
    fixture.terminal.select(0, rangeBefore.start, "later-copy".length);

    fixture.history.resize(10, 4);

    const rangeAfter = requiredRange("later-selection", fixture.history);
    assertEqual(
      fixture.terminal.getSelection(),
      "later-copy",
      "selection after an earlier Block reflows",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      rangeAfter.start,
      "selection row after an earlier Block reflows",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "later-copy",
      "copy event after an earlier Block reflows",
    );
    return {
      name: "Earlier Block Reflow",
      detail: "the later selection moved with its Block and copied unchanged",
    };
  } finally {
    fixture.dispose();
  }
}

async function runRetainedCapacitySelectionScenario(): Promise<ScenarioResult> {
  const fixture = await createCapacityFixture();
  try {
    const readerBefore = requiredRange("capacity-reader", fixture.history);
    fixture.terminal.select(0, readerBefore.start, "reader".length);

    await growCapacityFixture(fixture.history);

    const readerAfter = requiredRange("capacity-reader", fixture.history);
    assertEqual(
      fixture.history.range("capacity-oldest"),
      undefined,
      "oldest Block range after capacity eviction",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "reader",
      "retained selection after capacity eviction",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      readerAfter.start,
      "retained selection row after capacity eviction",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "reader",
      "retained copy event after capacity eviction",
    );
    return {
      name: "Capacity Evicts Earlier Block",
      detail: "the retained selection moved with its Block and copied unchanged",
    };
  } finally {
    fixture.dispose();
  }
}

async function runEvictedCapacitySelectionScenario(): Promise<ScenarioResult> {
  const fixture = await createCapacityFixture();
  try {
    const oldest = requiredRange("capacity-oldest", fixture.history);
    fixture.terminal.select(0, oldest.start, "old-11111".length);

    await growCapacityFixture(fixture.history);

    assertEqual(
      fixture.history.range("capacity-oldest"),
      undefined,
      "selected Block range after capacity eviction",
    );
    assertEqual(
      fixture.terminal.hasSelection(),
      false,
      "selection after its complete Block is evicted",
    );
    assertEqual(
      copySelection(fixture.terminal),
      undefined,
      "copy event after the selected Block is evicted",
    );
    return {
      name: "Capacity Evicts Selected Block",
      detail: "the selection and copy source were cleared",
    };
  } finally {
    fixture.dispose();
  }
}

async function createCapacityFixture(): Promise<ReturnType<typeof createIsolatedFixture>> {
  const fixture = createIsolatedFixture({
    cols: 10,
    rows: 3,
    scrollback: 7,
  });
  await fixture.history.apply({
    type: "append",
    block: {
      id: "capacity-oldest",
      lifecycle: "sealed",
      content: "old-11111old-22222",
    },
  });
  await fixture.history.apply({
    type: "append",
    block: {
      id: "capacity-growing",
      lifecycle: "mutable",
      content: "draft",
    },
  });
  await fixture.history.apply({
    type: "append",
    block: {
      id: "capacity-reader",
      lifecycle: "sealed",
      content: "reader",
    },
  });
  await fixture.history.apply({
    type: "append",
    block: {
      id: "capacity-tail",
      lifecycle: "sealed",
      content: "tail-1111tail-2222tail-3333tail-4",
    },
  });
  return fixture;
}

async function growCapacityFixture(
  fixtureHistory: BrowserSelectionHistory,
): Promise<void> {
  await fixtureHistory.apply({
    type: "update",
    id: "capacity-growing",
    content: "new-11111new-22222new-33333new-4",
  });
}

function createIsolatedFixture(options: {
  readonly cols?: number;
  readonly rows?: number;
  readonly scrollback?: number;
} = {}): {
  readonly terminal: Terminal;
  readonly history: BrowserSelectionHistory;
  dispose(): void;
} {
  const host = document.createElement("div");
  host.className = "isolated-terminal";
  document.body.appendChild(host);
  const isolatedTerminal = new Terminal({
    cols: options.cols ?? 20,
    rows: options.rows ?? 4,
    scrollback: options.scrollback ?? 100,
    disableStdin: true,
  });
  isolatedTerminal.open(host);
  const isolatedHistory = new BrowserSelectionHistory(isolatedTerminal);
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

function copySelection(source: Terminal = terminal): string | undefined {
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
  source.element?.dispatchEvent(event);
  return copied;
}

function requiredRange(
  id: string,
  source: BrowserSelectionHistory = history,
): Readonly<{ start: number; lineCount: number }> {
  const range = source.range(id);
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
