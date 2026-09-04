import {
  append,
  assertBlockContent,
  assertBufferRows,
  assertEqual,
  assertNoMixedErrors,
  assertSelectionAndCopy,
  assertSelectionPosition,
  concatenate,
  createMixedFixture,
  encodeInput,
  requiredRange,
  selectAcrossRows,
  text,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runResizePreservesMixedSelectionScenario(): Promise<
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
            "managed",
            "managed-0123456789-ABCD",
            "mutable",
          ),
          3,
        ),
        text("ordinary-0123456789\r\n"),
        encodeInput(
          append(fixture.contextId, "2", "tail", "tail", "sealed"),
          4,
        ),
      ]),
    );
    assertNoMixedErrors(fixture, "initial resize boundary stream");

    const managedBefore = requiredRange(fixture, "managed");
    const tailBefore = requiredRange(fixture, "tail");
    const ordinaryBefore = managedBefore.start + managedBefore.lineCount;
    assertEqual(managedBefore.start, 0, "managed start before resize");
    assertEqual(managedBefore.lineCount, 2, "managed rows before resize");
    assertEqual(tailBefore.start, 3, "tail start before resize");
    assertEqual(tailBefore.lineCount, 1, "tail rows before resize");
    selectAcrossRows(
      fixture.terminal,
      15,
      managedBefore.start,
      15,
      ordinaryBefore,
    );
    assertSelectionPosition(
      fixture.terminal,
      15,
      managedBefore.start,
      15,
      ordinaryBefore,
      "mixed selection before resize",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "789-ABCD\nordinary-012345",
      "mixed selection before resize",
    );
    assertBufferRows(fixture.terminal, [
      "managed-0123456789-A",
      "BCD",
      "ordinary-0123456789",
      "tail",
      "",
    ]);
    assertBlockContent(fixture, "managed", "managed-0123456789-ABCD");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context before resize",
    );

    fixture.resize(10, 4);

    const managedNarrow = requiredRange(fixture, "managed");
    const tailNarrow = requiredRange(fixture, "tail");
    const ordinaryNarrow = managedNarrow.start + managedNarrow.lineCount;
    assertEqual(managedNarrow.start, 0, "managed start after narrowing");
    assertEqual(managedNarrow.lineCount, 3, "managed rows after narrowing");
    assertEqual(tailNarrow.start, 5, "tail start after narrowing");
    assertEqual(tailNarrow.lineCount, 1, "tail rows after narrowing");
    assertSelectionPosition(
      fixture.terminal,
      5,
      managedNarrow.start + 1,
      5,
      ordinaryNarrow + 1,
      "mixed selection after narrowing",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "789-ABCD\nordinary-012345",
      "mixed selection after narrowing",
    );
    assertBufferRows(fixture.terminal, [
      "managed-01",
      "23456789-A",
      "BCD",
      "ordinary-0",
      "123456789",
      "tail",
      "",
    ]);
    assertBlockContent(fixture, "managed", "managed-0123456789-ABCD");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after narrowing",
    );

    fixture.resize(20, 4);

    const managedWide = requiredRange(fixture, "managed");
    const tailWide = requiredRange(fixture, "tail");
    const ordinaryWide = managedWide.start + managedWide.lineCount;
    assertEqual(managedWide.start, 0, "managed start after widening");
    assertEqual(managedWide.lineCount, 2, "managed rows after widening");
    assertEqual(tailWide.start, 3, "tail start after widening");
    assertEqual(tailWide.lineCount, 1, "tail rows after widening");
    assertSelectionPosition(
      fixture.terminal,
      15,
      managedWide.start,
      15,
      ordinaryWide,
      "mixed selection after widening",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "789-ABCD\nordinary-012345",
      "mixed selection after widening",
    );
    assertBufferRows(fixture.terminal, [
      "managed-0123456789-A",
      "BCD",
      "ordinary-0123456789",
      "tail",
      "",
    ]);
    assertBlockContent(fixture, "managed", "managed-0123456789-ABCD");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after widening",
    );
    return {
      name:
        "Resize Round Trip Preserves a Managed-to-Unmanaged Selection Through Reflow",
      detail:
        "both endpoints followed their logical ASCII offsets through 20-to-10-to-20-column reflow while copied text stayed unchanged",
    };
  } finally {
    fixture.dispose();
  }
}
