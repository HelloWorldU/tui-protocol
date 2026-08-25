import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  BrowserMetadataHistory,
  type CellStyleSnapshot,
  type MetadataStyle,
} from "./metadata-history.ts";
import "./style.css";

interface ScenarioResult {
  readonly name: string;
  readonly detail: string;
}

const expectedStyles = {
  "blue-bold": { bold: true, foreground: 0x2563eb },
  green: { bold: false, foreground: 0x16a34a },
  "red-bold": { bold: true, foreground: 0xdc2626 },
} as const satisfies Record<
  MetadataStyle,
  Pick<CellStyleSnapshot, "bold" | "foreground">
>;

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
const history = await BrowserMetadataHistory.create(terminal);

try {
  const results = await runScenarios();
  summaryElement.textContent = `${results.length} browser metadata scenarios passed.`;
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
  return [
    await runUpdateReplacesMetadataScenario(),
    await runUpdateRemovesMetadataScenario(),
    await runEarlierBlockUpdateScenario(),
    await runReflowScenario(),
    await runCapacityScenario(),
  ];
}

async function runUpdateReplacesMetadataScenario(): Promise<ScenarioResult> {
  const fixture = await createIsolatedFixture();
  try {
    await fixture.history.apply(
      {
        type: "append",
        block: { id: "replace-style", lifecycle: "mutable", content: "draft" },
      },
      "red-bold",
    );
    assertBlockStyle(fixture.history, "replace-style", "red-bold");

    await fixture.history.apply(
      { type: "update", id: "replace-style", content: "final" },
      "green",
    );
    assertBlockStyle(fixture.history, "replace-style", "green");
    return {
      name: "Update Replaces Metadata",
      detail: "the replacement text used only its new foreground and weight",
    };
  } finally {
    fixture.dispose();
  }
}

async function runUpdateRemovesMetadataScenario(): Promise<ScenarioResult> {
  const fixture = await createIsolatedFixture();
  try {
    await fixture.history.apply(
      {
        type: "append",
        block: { id: "remove-style", lifecycle: "mutable", content: "styled" },
      },
      "red-bold",
    );

    await fixture.history.apply({
      type: "update",
      id: "remove-style",
      content: "plain",
    });

    assertBlockDefaultStyle(fixture.history, "remove-style");
    assertEqual(
      fixture.history.hasMetadata("remove-style"),
      false,
      "metadata after an unstyled replacement",
    );
    return {
      name: "Update Removes Omitted Metadata",
      detail: "the replacement did not retain styling from the old snapshot",
    };
  } finally {
    fixture.dispose();
  }
}

async function runEarlierBlockUpdateScenario(): Promise<ScenarioResult> {
  const fixture = await createIsolatedFixture({ cols: 10, rows: 4 });
  try {
    await fixture.history.apply(
      {
        type: "append",
        block: { id: "earlier", lifecycle: "mutable", content: "early" },
      },
      "red-bold",
    );
    await fixture.history.apply(
      {
        type: "append",
        block: { id: "later", lifecycle: "sealed", content: "later-blue" },
      },
      "blue-bold",
    );
    const startBefore = requiredStart(fixture.history, "later");

    await fixture.history.apply(
      {
        type: "update",
        id: "earlier",
        content: "early-111 early-222 early-333",
      },
      "green",
    );

    const startAfter = requiredStart(fixture.history, "later");
    assertTrue(startAfter > startBefore, "later Block moved after earlier growth");
    assertBlockStyle(fixture.history, "later", "blue-bold");
    return {
      name: "Earlier Block Update",
      detail: "the later Block moved while its own styling stayed attached",
    };
  } finally {
    fixture.dispose();
  }
}

async function runReflowScenario(): Promise<ScenarioResult> {
  const fixture = await createIsolatedFixture({ cols: 20, rows: 4 });
  try {
    await fixture.history.apply(
      {
        type: "append",
        block: {
          id: "reflow-style",
          lifecycle: "sealed",
          content: "metadata-follows-reflow",
        },
      },
      "blue-bold",
    );
    const linesBefore = requiredLineCount(fixture.history, "reflow-style");

    fixture.history.resize(8, 4);

    const linesAfter = requiredLineCount(fixture.history, "reflow-style");
    assertTrue(linesAfter > linesBefore, "styled Block gained wrapped rows");
    assertBlockStyle(fixture.history, "reflow-style", "blue-bold");
    return {
      name: "Reflow Preserves Metadata",
      detail: "every character kept its styling after wrapping onto more rows",
    };
  } finally {
    fixture.dispose();
  }
}

async function runCapacityScenario(): Promise<ScenarioResult> {
  const fixture = await createIsolatedFixture({
    cols: 10,
    rows: 3,
    scrollback: 7,
  });
  try {
    await fixture.history.apply(
      {
        type: "append",
        block: {
          id: "capacity-oldest",
          lifecycle: "sealed",
          content: "old-11111old-22222",
        },
      },
      "red-bold",
    );
    await fixture.history.apply(
      {
        type: "append",
        block: { id: "capacity-growing", lifecycle: "mutable", content: "draft" },
      },
      "green",
    );
    await fixture.history.apply(
      {
        type: "append",
        block: { id: "capacity-retained", lifecycle: "sealed", content: "retained" },
      },
      "blue-bold",
    );
    await fixture.history.apply({
      type: "append",
      block: {
        id: "capacity-tail",
        lifecycle: "sealed",
        content: "tail-1111tail-2222tail-3333tail-4",
      },
    });

    await fixture.history.apply(
      {
        type: "update",
        id: "capacity-growing",
        content: "new-11111new-22222new-33333new-4",
      },
      "green",
    );

    assertEqual(
      fixture.history.range("capacity-oldest"),
      undefined,
      "oldest Block range after capacity eviction",
    );
    assertEqual(
      fixture.history.hasMetadata("capacity-oldest"),
      false,
      "oldest Block metadata after capacity eviction",
    );
    assertBlockStyle(fixture.history, "capacity-retained", "blue-bold");
    return {
      name: "Capacity Evicts Styled Block",
      detail: "evicted styling disappeared without changing a retained Block",
    };
  } finally {
    fixture.dispose();
  }
}

async function createIsolatedFixture(options: {
  readonly cols?: number;
  readonly rows?: number;
  readonly scrollback?: number;
} = {}): Promise<{
  readonly terminal: Terminal;
  readonly history: BrowserMetadataHistory;
  dispose(): void;
}> {
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
  const isolatedHistory = await BrowserMetadataHistory.create(isolatedTerminal);
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

function assertBlockStyle(
  source: BrowserMetadataHistory,
  id: string,
  style: MetadataStyle,
): void {
  const expected = expectedStyles[style];
  for (let offset = 0; offset < source.content(id).length; offset += 1) {
    const actual = source.cellStyle(id, offset);
    assertEqual(actual.bold, expected.bold, `${id} bold at offset ${offset}`);
    assertEqual(
      actual.foreground,
      expected.foreground,
      `${id} foreground at offset ${offset}`,
    );
    assertTrue(
      actual.foregroundMode !== 0,
      `${id} foreground mode at offset ${offset}`,
    );
  }
}

function assertBlockDefaultStyle(source: BrowserMetadataHistory, id: string): void {
  for (let offset = 0; offset < source.content(id).length; offset += 1) {
    const actual = source.cellStyle(id, offset);
    assertEqual(actual.bold, false, `${id} bold at offset ${offset}`);
    assertEqual(actual.foregroundMode, 0, `${id} foreground mode at offset ${offset}`);
    assertEqual(actual.foreground, -1, `${id} foreground at offset ${offset}`);
  }
}

function requiredStart(source: BrowserMetadataHistory, id: string): number {
  const range = source.range(id);
  if (range === undefined) {
    throw new Error(`Block ${JSON.stringify(id)} has no rendered range.`);
  }
  return range.start;
}

function requiredLineCount(source: BrowserMetadataHistory, id: string): number {
  const range = source.range(id);
  if (range === undefined) {
    throw new Error(`Block ${JSON.stringify(id)} has no rendered range.`);
  }
  return range.lineCount;
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

function assertTrue(value: boolean, label: string): void {
  if (!value) {
    throw new Error(`${label}: expected true, received false.`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
