import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  BrowserActiveInputHistory,
  type ActiveInputSnapshot,
} from "./input-history.ts";
import "./style.css";

interface ScenarioResult {
  readonly name: string;
  readonly detail: string;
}

interface Fixture {
  readonly terminal: Terminal;
  readonly history: BrowserActiveInputHistory;
  dispose(): void;
}

const terminalElement = requiredElement("terminal");
const summaryElement = requiredElement("summary");
const resultsElement = requiredElement("results");

const terminal = new Terminal({ cols: 20, rows: 4, scrollback: 100 });
terminal.open(terminalElement);

try {
  const results = await runScenarios();
  summaryElement.textContent = `${results.length} browser active-input scenarios passed.`;
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
    await runUpdateScenario(),
    await runIncrementalOperationsScenario(),
    await runReflowScenario(),
    await runCapacityScenario(),
    await runCompositionScenario(),
  ];
}

async function runUpdateScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture({ cols: 20, rows: 4 });
  try {
    await appendMutableBlock(fixture.history, "update-history", "short");
    await setFocusedInput(fixture.history, "> ", "draft command", 5);
    const before = fixture.history.snapshot();

    await fixture.history.apply({
      type: "update",
      id: "update-history",
      content: "history-111 history-222 history-333",
    });

    const after = fixture.history.snapshot();
    assertInputUnchanged(after, before, "input after historical Update");
    assertTrue(
      after.absoluteRow > before.absoluteRow,
      "active input moved below the taller history",
    );
    return {
      name: "Earlier Block Update Preserves Active Input",
      detail: "the text, cursor offset, and focus stayed unchanged",
    };
  } finally {
    fixture.dispose();
  }
}

async function runIncrementalOperationsScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture({ cols: 20, rows: 4 });
  try {
    await appendMutableBlock(fixture.history, "incremental-history", "thinking");
    await setFocusedInput(fixture.history, "> ", "edit next", 4);
    const before = fixture.history.snapshot();

    await fixture.history.apply({
      type: "extend",
      id: "incremental-history",
      fragment: "-streaming-more",
    });
    assertInputUnchanged(
      fixture.history.snapshot(),
      before,
      "input after historical Extend",
    );

    await fixture.history.apply({
      type: "replaceSuffix",
      id: "incremental-history",
      retain: "thinking".length,
      replacement: "-final-answer-longer",
    });
    assertInputUnchanged(
      fixture.history.snapshot(),
      before,
      "input after historical ReplaceSuffix",
    );
    return {
      name: "Incremental History Changes Preserve Active Input",
      detail: "Extend and ReplaceSuffix changed no input text, cursor, or focus",
    };
  } finally {
    fixture.dispose();
  }
}

async function runReflowScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture({ cols: 20, rows: 4 });
  try {
    await appendMutableBlock(
      fixture.history,
      "reflow-history",
      "history-needs-reflow",
    );
    await setFocusedInput(fixture.history, "> ", "edit", 2);
    const before = fixture.history.snapshot();

    fixture.history.resize(10, 4);

    const after = fixture.history.snapshot();
    assertInputUnchanged(after, before, "input after history reflow");
    assertTrue(
      after.absoluteRow > before.absoluteRow,
      "active input moved below reflowed history",
    );
    return {
      name: "History Reflow Preserves Active Input",
      detail: "the input moved physically but kept its text, cursor, and focus",
    };
  } finally {
    fixture.dispose();
  }
}

async function runCapacityScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture({
    cols: 10,
    rows: 3,
    scrollback: 7,
  });
  try {
    await appendSealedBlock(
      fixture.history,
      "capacity-oldest",
      "old-11111old-22222",
    );
    await appendMutableBlock(fixture.history, "capacity-growing", "draft");
    await appendSealedBlock(fixture.history, "capacity-retained", "reader");
    await appendSealedBlock(
      fixture.history,
      "capacity-tail",
      "tail-1111tail-2222tail-3333tail-4",
    );
    await setFocusedInput(fixture.history, "> ", "edit", 2);
    const before = fixture.history.snapshot();

    await fixture.history.apply({
      type: "update",
      id: "capacity-growing",
      content: "new-11111new-22222new-33333new-4",
    });

    assertEqual(
      fixture.history.range("capacity-oldest"),
      undefined,
      "oldest Block range after capacity eviction",
    );
    assertInputUnchanged(
      fixture.history.snapshot(),
      before,
      "input after complete-Block capacity eviction",
    );
    return {
      name: "Capacity Eviction Preserves Active Input",
      detail: "trimming an old complete Block changed no active input state",
    };
  } finally {
    fixture.dispose();
  }
}

async function runCompositionScenario(): Promise<ScenarioResult> {
  const fixture = createIsolatedFixture({ cols: 20, rows: 4 });
  try {
    await appendMutableBlock(fixture.history, "composition-history", "short");
    await setFocusedInput(fixture.history, "> ", "compose", 3);
    const inputBefore = fixture.history.snapshot();
    const textarea = fixture.history.textarea();
    const compositionView = fixture.history.compositionView();
    let compositionEndCount = 0;
    let dataSent = "";
    textarea.addEventListener("compositionend", () => {
      compositionEndCount += 1;
    });
    const dataRegistration = fixture.terminal.onData((data) => {
      dataSent += data;
    });

    textarea.value = "";
    textarea.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );
    textarea.value = "拼";
    textarea.dispatchEvent(
      new CompositionEvent("compositionupdate", { bubbles: true, data: "拼" }),
    );
    await nextTurn();
    assertTrue(
      compositionView.classList.contains("active"),
      "composition view before history change",
    );

    await fixture.history.apply({
      type: "update",
      id: "composition-history",
      content: "history-111 history-222",
    });
    await nextTurn();

    assertInputUnchanged(
      fixture.history.snapshot(),
      inputBefore,
      "input during historical Update",
    );
    assertEqual(
      compositionEndCount,
      0,
      "compositionend events during historical Update",
    );
    assertEqual(dataSent, "", "input data sent during historical Update");
    assertEqual(textarea.value, "拼", "textarea value during composition");
    assertEqual(compositionView.textContent, "拼", "composition view text");
    assertTrue(
      compositionView.classList.contains("active"),
      "composition view after history change",
    );

    textarea.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "拼" }),
    );
    await nextTurn();
    dataRegistration.dispose();
    return {
      name: "Historical Update Does Not End Composition",
      detail: "the synthetic composition stayed active and sent no input data",
    };
  } finally {
    fixture.dispose();
  }
}

function createIsolatedFixture(options: {
  readonly cols: number;
  readonly rows: number;
  readonly scrollback?: number;
}): Fixture {
  const host = document.createElement("div");
  host.className = "isolated-terminal";
  document.body.appendChild(host);
  const isolatedTerminal = new Terminal({
    cols: options.cols,
    rows: options.rows,
    scrollback: options.scrollback ?? 100,
  });
  isolatedTerminal.open(host);
  const isolatedHistory = new BrowserActiveInputHistory(isolatedTerminal);
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

async function appendMutableBlock(
  history: BrowserActiveInputHistory,
  id: string,
  content: string,
): Promise<void> {
  await history.apply({
    type: "append",
    block: { id, lifecycle: "mutable", content },
  });
}

async function appendSealedBlock(
  history: BrowserActiveInputHistory,
  id: string,
  content: string,
): Promise<void> {
  await history.apply({
    type: "append",
    block: { id, lifecycle: "sealed", content },
  });
}

async function setFocusedInput(
  history: BrowserActiveInputHistory,
  prompt: string,
  content: string,
  cursorOffset: number,
): Promise<void> {
  await history.setActiveInput(prompt, content, cursorOffset);
  history.focus();
  assertEqual(history.snapshot().focused, true, "initial input focus");
}

function assertInputUnchanged(
  actual: ActiveInputSnapshot,
  expected: ActiveInputSnapshot,
  label: string,
): void {
  assertEqual(actual.content, expected.content, `${label} content`);
  assertEqual(
    actual.cursorOffset,
    expected.cursorOffset,
    `${label} cursor offset`,
  );
  assertEqual(actual.focused, true, `${label} focus`);
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
