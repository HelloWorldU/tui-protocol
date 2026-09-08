import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  runAppendHistoryReadingAndSelectionScenario,
  runAppendSearchScenario,
  runAppendTailFollowingScenario,
} from "./scenarios/append.ts";
import {
  runAppendCapacityEvictsSelectedOldestBlockScenario,
} from "./scenarios/append-capacity.ts";
import {
  runAdjacentManagedBlocksCopyOneSuppliedNewlineScenario,
  runTrailingNewlineDoesNotDuplicateAdjacentManagedCopyBoundaryScenario,
} from "./scenarios/adjacent-managed-selection.ts";
import {
  runCapacityActiveInputScenario,
  runCapacityEvictsSearchMatchScenario,
  runCapacityEvictsSelectedBlockScenario,
  runCapacityRetainsSearchMatchScenario,
  runCapacityRetainsSelectionAndReadingScenario,
  runProjectedCapacityRetainsSelectionScenario,
  runProjectedCapacityEvictsSelectionScenario,
} from "./scenarios/capacity.ts";
import {
  runExtendActiveInputAndCompositionScenario,
  runExtendSearchScenario,
  runExtendSelectionAndReadingScenario,
} from "./scenarios/extend.ts";
import {
  runAppendAndSealPreserveMixedSelectionScenario,
  runEarlierUpdatePreservesMixedSelectionScenario,
  runExtendExcludesFragmentAfterMixedSelectionScenario,
  runExtendIncludesFragmentInMixedSelectionScenario,
  runReplaceSuffixClearsMixedRemovedSuffixSelectionScenario,
  runReplaceSuffixPreservesMixedPrefixSelectionScenario,
  runSelectedUpdateClearsMixedSelectionScenario,
} from "./scenarios/mixed-ingress.ts";
import {
  runCapacityEvictsEarlierBlockAndPreservesMixedSelectionScenario,
  runCapacityEvictsSelectedBlockAndClearsMixedSelectionScenario,
} from "./scenarios/mixed-selection-capacity.ts";
import { runExtendIncludesFragmentAcrossTwoMixedBoundariesScenario } from "./scenarios/mixed-selection-layout.ts";
import { runExtendExcludesFragmentFromSelectionEndingAtOldManagedTailScenario } from "./scenarios/mixed-selection-managed-tail.ts";
import { runResizePreservesMixedSelectionScenario } from "./scenarios/mixed-selection-resize.ts";
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
import {
  runPlainTextNewlineAndControlScenario,
  runPlainTextTabReflowScenario,
  runPlainTextRetainedSelectionScenario,
  runPlainTextMixedCopyScenario,
  runPlainTextPartialTabScenario,
} from "./scenarios/plain-text.ts";
import "./style.css";
import {
  runChineseSearchReflowScenario,
  runChineseRepeatedSearchScenario,
  runChineseSearchMutationScenario,
  runAdjacentChineseSearchScenario,
} from "./scenarios/chinese-search.ts";
import {
  runChineseTabReflowScenario,
  runChinesePartialSelectionScenario,
  runChineseRetainedSelectionScenario,
} from "./scenarios/plain-text-chinese.ts";

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
    await runAppendCapacityEvictsSelectedOldestBlockScenario(),
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
    await runProjectedCapacityRetainsSelectionScenario(),
    await runProjectedCapacityEvictsSelectionScenario(),
    await runAdjacentManagedBlocksCopyOneSuppliedNewlineScenario(),
    await runTrailingNewlineDoesNotDuplicateAdjacentManagedCopyBoundaryScenario(),
    await runEarlierUpdatePreservesMixedSelectionScenario(),
    await runSelectedUpdateClearsMixedSelectionScenario(),
    await runExtendIncludesFragmentInMixedSelectionScenario(),
    await runExtendExcludesFragmentAfterMixedSelectionScenario(),
    await runReplaceSuffixPreservesMixedPrefixSelectionScenario(),
    await runReplaceSuffixClearsMixedRemovedSuffixSelectionScenario(),
    await runAppendAndSealPreserveMixedSelectionScenario(),
    await runExtendIncludesFragmentAcrossTwoMixedBoundariesScenario(),
    await runExtendExcludesFragmentFromSelectionEndingAtOldManagedTailScenario(),
    await runResizePreservesMixedSelectionScenario(),
    await runCapacityEvictsEarlierBlockAndPreservesMixedSelectionScenario(),
    await runCapacityEvictsSelectedBlockAndClearsMixedSelectionScenario(),
    await runPlainTextNewlineAndControlScenario(),
    await runPlainTextTabReflowScenario(),
    await runPlainTextRetainedSelectionScenario(),
    await runPlainTextMixedCopyScenario(),
    await runPlainTextPartialTabScenario(),
    await runChineseTabReflowScenario(),
    await runChinesePartialSelectionScenario(),
    await runChineseRetainedSelectionScenario(),
    await runChineseSearchReflowScenario(),
    await runChineseRepeatedSearchScenario(),
    await runChineseSearchMutationScenario(),
    await runAdjacentChineseSearchScenario(),
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
