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

export async function runExtendExcludesFragmentFromSelectionEndingAtOldManagedTailScenario(): Promise<
  ScenarioResult
> {
  const fixture = await createMixedFixture({ cols: 20, rows: 4 });
  const oldContent = "managed-0123456789XY";
  const fragment = "-new-fragment";
  try {
    assertEqual(
      oldContent.length,
      fixture.terminal.cols,
      "old managed content fills exactly one terminal row",
    );
    await fixture.ingress.push(
      concatenate([
        encodeInput(
          append(
            fixture.contextId,
            "1",
            "managed",
            oldContent,
            "mutable",
          ),
          3,
        ),
        text("ordinary\r\n"),
        encodeInput(
          append(fixture.contextId, "2", "tail", "tail", "sealed"),
          4,
        ),
      ]),
    );
    assertNoMixedErrors(fixture, "initial managed-tail selection stream");

    const managedBefore = requiredRange(fixture, "managed");
    const tailBefore = requiredRange(fixture, "tail");
    const ordinaryBefore = managedBefore.start + managedBefore.lineCount;
    assertEqual(managedBefore.start, 0, "managed start before Extend");
    assertEqual(managedBefore.lineCount, 1, "managed rows before Extend");
    assertEqual(ordinaryBefore, 1, "ordinary row before Extend");
    assertEqual(
      fixture.terminal.buffer.normal.getLine(ordinaryBefore)?.isWrapped,
      false,
      "managed-to-unmanaged boundary before Extend is a hard line boundary",
    );
    assertEqual(tailBefore.start, 2, "tail start before Extend");
    assertEqual(tailBefore.lineCount, 1, "tail rows before Extend");

    selectAcrossRows(
      fixture.terminal,
      0,
      managedBefore.start,
      oldContent.length,
      managedBefore.start,
    );
    assertSelectionPosition(
      fixture.terminal,
      0,
      managedBefore.start,
      oldContent.length,
      managedBefore.start,
      "selection ending at the old managed tail before Extend",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      oldContent,
      "selection ending at the old managed tail before Extend",
    );
    assertBufferRows(fixture.terminal, [
      oldContent,
      "ordinary",
      "tail",
      "",
    ]);
    assertBlockContent(fixture, "managed", oldContent);
    assertBlockLifecycle(fixture, "managed", "mutable");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context before managed-tail Extend",
    );

    await fixture.ingress.push(
      encodeInput(
        extend(fixture.contextId, "3", "managed", "1", fragment),
        5,
      ),
    );
    assertNoMixedErrors(fixture, "managed-tail Extend");

    const managedAfter = requiredRange(fixture, "managed");
    const tailAfter = requiredRange(fixture, "tail");
    const ordinaryAfter = managedAfter.start + managedAfter.lineCount;
    assertEqual(managedAfter.start, 0, "managed start after Extend");
    assertEqual(managedAfter.lineCount, 2, "managed rows after Extend");
    assertEqual(
      fixture.terminal.buffer.normal.getLine(managedAfter.start + 1)?.isWrapped,
      true,
      "appended fragment row is a soft wrap of the managed Block",
    );
    assertEqual(ordinaryAfter, 2, "ordinary row after Extend");
    assertEqual(
      fixture.terminal.buffer.normal.getLine(ordinaryAfter)?.isWrapped,
      false,
      "managed-to-unmanaged boundary after Extend remains a hard line boundary",
    );
    assertEqual(tailAfter.start, 3, "tail start after Extend");
    assertEqual(tailAfter.lineCount, 1, "tail rows after Extend");
    assertSelectionPosition(
      fixture.terminal,
      0,
      managedAfter.start,
      oldContent.length,
      managedAfter.start,
      "selection ending at the old managed tail after Extend",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      oldContent,
      "selection ending at the old managed tail after Extend",
    );
    assertBufferRows(fixture.terminal, [
      oldContent,
      fragment,
      "ordinary",
      "tail",
      "",
    ]);
    assertBlockContent(fixture, "managed", `${oldContent}${fragment}`);
    assertBlockLifecycle(fixture, "managed", "mutable");
    assertBlockContent(fixture, "tail", "tail");
    assertBlockLifecycle(fixture, "tail", "sealed");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after managed-tail Extend",
    );

    return {
      name:
        "Extend Leaves Its New Fragment Outside a Selection Ending at the Old Managed Tail",
      detail:
        "the selection kept its column-20 endpoint and copied only the old content while ordinary output and the later Block moved down one row",
    };
  } finally {
    fixture.dispose();
  }
}
