import {
  append,
  assertBlockContent,
  assertBlockLifecycle,
  assertBufferRows,
  assertEqual,
  assertSelectionAndCopy,
  assertSelectionPosition,
  createFixture,
  pushMessages,
  requiredRange,
  selectAcrossRows,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export function runAdjacentManagedBlocksCopyOneSuppliedNewlineScenario(): Promise<
  ScenarioResult
> {
  return runAdjacentManagedCopyScenario(
    "alpha",
    "Adjacent Managed Blocks Copy One Terminal-Supplied Newline",
    "copying from alpha into bravo produced pha, one newline, and bra",
    "terminal-supplied adjacent-Block boundary",
  );
}

export function runTrailingNewlineDoesNotDuplicateAdjacentManagedCopyBoundaryScenario(): Promise<
  ScenarioResult
> {
  return runAdjacentManagedCopyScenario(
    "alpha\n",
    "A Trailing Newline Does Not Duplicate the Adjacent Managed Block Copy Boundary",
    "alpha's trailing newline supplied the only copied line break before bravo",
    "trailing-newline adjacent-Block boundary",
  );
}

async function runAdjacentManagedCopyScenario(
  firstContent: string,
  name: string,
  detail: string,
  label: string,
): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 3 });
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "first", firstContent, "sealed"),
      append(fixture.contextId, "2", "second", "bravo", "sealed"),
    ]);
    await fixture.endpoint.drain();

    const first = requiredRange(fixture, "first");
    const second = requiredRange(fixture, "second");
    assertEqual(first.start, 0, `${label} first Block start`);
    assertEqual(first.lineCount, 1, `${label} first Block rows`);
    assertEqual(second.start, 1, `${label} second Block start`);
    assertEqual(second.lineCount, 1, `${label} second Block rows`);
    assertBufferRows(fixture.terminal, ["alpha", "bravo", ""]);

    selectAcrossRows(
      fixture.terminal,
      2,
      first.start,
      3,
      second.start,
    );
    assertSelectionPosition(
      fixture.terminal,
      2,
      first.start,
      3,
      second.start,
      label,
    );
    assertSelectionAndCopy(fixture.terminal, "pha\nbra", label);
    assertBlockContent(fixture, "first", firstContent);
    assertBlockLifecycle(fixture, "first", "sealed");
    assertBlockContent(fixture, "second", "bravo");
    assertBlockLifecycle(fixture, "second", "sealed");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      `${label} Context`,
    );

    return { name, detail };
  } finally {
    fixture.dispose();
  }
}
