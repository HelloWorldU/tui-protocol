import {
  append,
  assertBlockContent,
  assertBlockLifecycle,
  assertBufferRows,
  assertEqual,
  assertNoMixedErrors,
  assertSelectionAndCopy,
  assertSelectionPosition,
  concatenate,
  createMixedFixture,
  encodeInput,
  extend,
  requiredRange,
  selectAcrossRows,
  text,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runExtendIncludesFragmentAcrossTwoMixedBoundariesScenario(): Promise<
  ScenarioResult
> {
  const fixture = await createMixedFixture({ cols: 20, rows: 4 });
  try {
    await fixture.ingress.push(
      concatenate([
        encodeInput(
          append(
            fixture.contextId,
            "1",
            "managed-a",
            "managed-a",
            "mutable",
          ),
          3,
        ),
        text("ordinary\r\n"),
        encodeInput(
          append(
            fixture.contextId,
            "2",
            "managed-b",
            "managed-b",
            "sealed",
          ),
          4,
        ),
      ]),
    );
    assertNoMixedErrors(fixture, "initial two-boundary stream");

    const managedABefore = requiredRange(fixture, "managed-a");
    const managedBBefore = requiredRange(fixture, "managed-b");
    assertEqual(managedABefore.lineCount, 1, "managed A rows before Extend");
    assertEqual(managedBBefore.lineCount, 1, "managed B rows before Extend");
    assertEqual(
      managedBBefore.start,
      managedABefore.start + 2,
      "managed B row after the unmanaged row",
    );

    selectAcrossRows(
      fixture.terminal,
      3,
      managedABefore.start,
      4,
      managedBBefore.start,
    );
    assertSelectionPosition(
      fixture.terminal,
      3,
      managedABefore.start,
      4,
      managedBBefore.start,
      "two-boundary selection before Extend",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "aged-a\nordinary\nmana",
      "two-boundary selection before Extend",
    );

    const fragment = "-0123456789-0123456789-0123456789";
    await fixture.ingress.push(
      encodeInput(
        extend(fixture.contextId, "3", "managed-a", "1", fragment),
        5,
      ),
    );
    assertNoMixedErrors(fixture, "two-boundary Extend");

    const managedAAfter = requiredRange(fixture, "managed-a");
    const managedBAfter = requiredRange(fixture, "managed-b");
    assertEqual(
      managedAAfter.start,
      managedABefore.start,
      "managed A start after Extend",
    );
    assertEqual(managedAAfter.lineCount, 3, "managed A rows after Extend");
    assertEqual(
      managedBAfter.start,
      managedBBefore.start + 2,
      "managed B row after Extend",
    );
    assertSelectionPosition(
      fixture.terminal,
      3,
      managedAAfter.start,
      4,
      managedBAfter.start,
      "two-boundary selection after Extend",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      `aged-a${fragment}\nordinary\nmana`,
      "two-boundary selection after Extend",
    );
    assertBufferRows(fixture.terminal, [
      "managed-a-0123456789",
      "-0123456789-01234567",
      "89",
      "ordinary",
      "managed-b",
      "",
    ]);
    assertBlockContent(fixture, "managed-a", `managed-a${fragment}`);
    assertBlockContent(fixture, "managed-b", "managed-b");
    assertBlockLifecycle(fixture, "managed-b", "sealed");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after extending across two mixed boundaries",
    );
    return {
      name: "Extend Includes Its Fragment Across Two Mixed Boundaries",
      detail:
        "both endpoints stayed attached and copy kept one newline at each boundary",
    };
  } finally {
    fixture.dispose();
  }
}
