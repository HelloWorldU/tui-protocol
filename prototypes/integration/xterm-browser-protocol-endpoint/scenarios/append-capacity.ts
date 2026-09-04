import {
  append,
  assertBlockContent,
  assertBlockLifecycle,
  assertBufferRows,
  assertEqual,
  assertSelectionAndCopy,
  assertSelectionPosition,
  assertTrue,
  copySelection,
  createFixture,
  pushMessages,
  requiredRange,
  selectAcrossRows,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runAppendCapacityEvictsSelectedOldestBlockScenario(): Promise<
  ScenarioResult
> {
  const fixture = createFixture({ cols: 10, rows: 3, scrollback: 7 });
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "oldest",
        "old-1\nold-2",
        "sealed",
      ),
      append(fixture.contextId, "2", "next", "next", "sealed"),
      append(
        fixture.contextId,
        "3",
        "tail",
        "tail-1\ntail-2\ntail-3\ntail-4\ntail-5",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    const oldestBefore = requiredRange(fixture, "oldest");
    const nextBefore = requiredRange(fixture, "next");
    const tailBefore = requiredRange(fixture, "tail");
    assertEqual(oldestBefore.start, 0, "oldest Block start before Append");
    assertEqual(oldestBefore.lineCount, 2, "oldest Block rows before Append");
    assertEqual(nextBefore.start, 2, "next Block start before Append");
    assertEqual(nextBefore.lineCount, 1, "next Block rows before Append");
    assertEqual(tailBefore.start, 3, "tail Block start before Append");
    assertEqual(tailBefore.lineCount, 5, "tail Block rows before Append");
    assertBufferRows(fixture.terminal, [
      "old-1",
      "old-2",
      "next",
      "tail-1",
      "tail-2",
      "tail-3",
      "tail-4",
      "tail-5",
      "",
    ]);

    const selectedRow = oldestBefore.start + 1;
    fixture.terminal.scrollToLine(selectedRow);
    selectAcrossRows(fixture.terminal, 0, selectedRow, 5, selectedRow);
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      selectedRow,
      "viewport before Append capacity eviction",
    );
    assertEqual(
      fixture.terminal.buffer.active
        .getLine(fixture.terminal.buffer.active.viewportY)
        ?.translateToString(true),
      "old-2",
      "viewport text before Append capacity eviction",
    );
    assertSelectionPosition(
      fixture.terminal,
      0,
      selectedRow,
      5,
      selectedRow,
      "selection in the oldest Block before Append capacity eviction",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "old-2",
      "selection in the oldest Block before Append capacity eviction",
    );

    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "4",
        "new-tail",
        "new-1\nnew-2\nnew-3",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    assertEqual(
      fixture.endpoint.range(fixture.contextId, "oldest"),
      undefined,
      "oldest Block range after Append capacity eviction",
    );
    const nextAfter = requiredRange(fixture, "next");
    const tailAfter = requiredRange(fixture, "tail");
    const newTail = requiredRange(fixture, "new-tail");
    assertEqual(nextAfter.start, 0, "next Block start after capacity eviction");
    assertEqual(nextAfter.lineCount, 1, "next Block rows after capacity eviction");
    assertEqual(tailAfter.start, 1, "tail Block start after capacity eviction");
    assertEqual(tailAfter.lineCount, 5, "tail Block rows after capacity eviction");
    assertEqual(newTail.start, 6, "new tail Block start after capacity eviction");
    assertEqual(newTail.lineCount, 3, "new tail Block rows after capacity eviction");
    assertBufferRows(fixture.terminal, [
      "next",
      "tail-1",
      "tail-2",
      "tail-3",
      "tail-4",
      "tail-5",
      "new-1",
      "new-2",
      "new-3",
      "",
    ]);

    assertEqual(
      fixture.terminal.buffer.active.baseY,
      7,
      "terminal base after Append capacity eviction",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      nextAfter.start,
      "viewport after its selected Block is evicted by Append",
    );
    assertEqual(
      fixture.terminal.buffer.active
        .getLine(fixture.terminal.buffer.active.viewportY)
        ?.translateToString(true),
      "next",
      "viewport text after its selected Block is evicted by Append",
    );
    assertTrue(
      fixture.terminal.buffer.active.viewportY <
        fixture.terminal.buffer.active.baseY,
      "Append capacity eviction kept the viewport in history reading",
    );
    assertEqual(
      fixture.terminal.hasSelection(),
      false,
      "selection after its complete oldest Block is evicted by Append",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition(),
      undefined,
      "selection position after its complete oldest Block is evicted by Append",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "",
      "selection text after its complete oldest Block is evicted by Append",
    );
    assertEqual(
      copySelection(fixture.terminal),
      undefined,
      "copy after its complete oldest Block is evicted by Append",
    );

    assertEqual(
      JSON.stringify(
        fixture.endpoint
          .context(fixture.contextId)
          ?.blocks.map((block) => block.id),
      ),
      JSON.stringify(["oldest", "next", "tail", "new-tail"]),
      "Session Block order after Append capacity eviction",
    );
    assertBlockContent(fixture, "oldest", "old-1\nold-2");
    assertBlockLifecycle(fixture, "oldest", "sealed");
    assertBlockContent(fixture, "new-tail", "new-1\nnew-2\nnew-3");
    assertBlockLifecycle(fixture, "new-tail", "sealed");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after Append capacity eviction",
    );

    return {
      name:
        "Append Capacity Eviction Clears a Selection in the Complete Oldest Block",
      detail:
        "the viewport moved to the next retained Block and stayed in history reading while the new tail rendered",
    };
  } finally {
    fixture.dispose();
  }
}
