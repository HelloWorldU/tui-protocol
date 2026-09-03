import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  runAppendHistoryReadingAndSelectionScenario,
  runAppendSearchScenario,
  runAppendTailFollowingScenario,
} from "./scenarios/append.ts";
import {
  runCapacityActiveInputScenario,
  runCapacityEvictsSearchMatchScenario,
  runCapacityEvictsSelectedBlockScenario,
  runCapacityRetainsSearchMatchScenario,
  runCapacityRetainsSelectionAndReadingScenario,
} from "./scenarios/capacity.ts";
import {
  runExtendActiveInputAndCompositionScenario,
  runExtendSearchScenario,
  runExtendSelectionAndReadingScenario,
} from "./scenarios/extend.ts";
import {
  runEarlierUpdatePreservesMixedSelectionScenario,
  runExtendIncludesFragmentInMixedSelectionScenario,
  runSelectedUpdateClearsMixedSelectionScenario,
} from "./scenarios/mixed-ingress.ts";
import {
  runReplaceSuffixActiveInputAndCompositionScenario,
  runReplaceSuffixRemovedSelectionScenario,
  runReplaceSuffixRetainedSelectionAndReadingScenario,
  runReplaceSuffixSearchScenario,
} from "./scenarios/replace-suffix.ts";
import {
  runResizeActiveInputScenario,
  runResizeReadingSelectionAndUpdateScenario,
  runResizeSearchScenario,
  runResizeTailFollowingScenario,
} from "./scenarios/resize.ts";
import {
  runSealSearchScenario,
  runSealSelectionAndRejectionScenario,
} from "./scenarios/seal.ts";
import {
  runActiveInputAndCompositionScenario,
  runSearchScenario,
  runSelectionAndReadingScenario,
} from "./scenarios/update.ts";
import type { ScenarioResult } from "./scenario-harness.ts";
import "./style.css";

const terminalElement = requiredElement("terminal");
const summaryElement = requiredElement("summary");
const resultsElement = requiredElement("results");

const terminal = new Terminal({ cols: 20, rows: 4, scrollback: 100 });
terminal.open(terminalElement);

try {
  const results = await runScenarios();
  summaryElement.textContent = `${results.length} browser endpoint scenarios passed.`;
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
    await runSelectionAndReadingScenario(),
    await runSearchScenario(),
    await runActiveInputAndCompositionScenario(),
    await runExtendSelectionAndReadingScenario(),
    await runExtendSearchScenario(),
    await runExtendActiveInputAndCompositionScenario(),
    await runReplaceSuffixRetainedSelectionAndReadingScenario(),
    await runReplaceSuffixRemovedSelectionScenario(),
    await runReplaceSuffixSearchScenario(),
    await runReplaceSuffixActiveInputAndCompositionScenario(),
    await runAppendHistoryReadingAndSelectionScenario(),
    await runAppendTailFollowingScenario(),
    await runAppendSearchScenario(),
    await runSealSelectionAndRejectionScenario(),
    await runSealSearchScenario(),
    await runResizeReadingSelectionAndUpdateScenario(),
    await runResizeSearchScenario(),
    await runResizeActiveInputScenario(),
    await runResizeTailFollowingScenario(),
    await runCapacityRetainsSelectionAndReadingScenario(),
    await runCapacityEvictsSelectedBlockScenario(),
    await runCapacityRetainsSearchMatchScenario(),
    await runCapacityEvictsSearchMatchScenario(),
    await runCapacityActiveInputScenario(),
    await runEarlierUpdatePreservesMixedSelectionScenario(),
    await runSelectedUpdateClearsMixedSelectionScenario(),
    await runExtendIncludesFragmentInMixedSelectionScenario(),
  ];
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Element ${JSON.stringify(id)} is missing.`);
  }
  return element;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
