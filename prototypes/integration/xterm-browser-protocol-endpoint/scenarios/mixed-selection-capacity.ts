import {
  append,
  assertBlockContent,
  assertBufferRows,
  assertEqual,
  assertNoMixedErrors,
  assertSelectionAndCopy,
  assertSelectionPosition,
  concatenate,
  copySelection,
  createMixedFixture,
  encodeInput,
  requiredRange,
  selectAcrossRows,
  text,
  update,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runCapacityEvictsEarlierBlockAndPreservesMixedSelectionScenario(): Promise<
  ScenarioResult
> {
  const fixture = await createMixedFixture({
    cols: 10,
    rows: 3,
    scrollback: 7,
  });
  try {
    await fixture.ingress.push(
      concatenate([
        encodeInput(
          append(
            fixture.contextId,
            "1",
            "oldest",
            "old-1\nold-2",
            "sealed",
          ),
          3,
        ),
        encodeInput(
          append(fixture.contextId, "2", "growing", "draft", "mutable"),
          4,
        ),
        encodeInput(
          append(
            fixture.contextId,
            "3",
            "selected",
            "selected",
            "sealed",
          ),
          5,
        ),
        text("ordinary\r\n"),
        encodeInput(
          append(
            fixture.contextId,
            "4",
            "tail",
            "tail-1\ntail-2\ntail-3",
            "sealed",
          ),
          6,
        ),
      ]),
    );
    assertNoMixedErrors(fixture, "initial retained capacity stream");
    assertBufferRows(fixture.terminal, [
      "old-1",
      "old-2",
      "draft",
      "selected",
      "ordinary",
      "tail-1",
      "tail-2",
      "tail-3",
      "",
    ]);

    const oldestBefore = requiredRange(fixture, "oldest");
    const selectedBefore = requiredRange(fixture, "selected");
    const ordinaryBefore = selectedBefore.start + selectedBefore.lineCount;
    assertEqual(oldestBefore.start, 0, "oldest Block before capacity trim");
    assertEqual(
      oldestBefore.lineCount,
      2,
      "complete oldest Block rows before capacity trim",
    );
    assertEqual(selectedBefore.start, 3, "selected Block before capacity trim");
    assertEqual(ordinaryBefore, 4, "unmanaged row before capacity trim");
    selectAcrossRows(
      fixture.terminal,
      0,
      selectedBefore.start,
      4,
      ordinaryBefore,
    );
    assertSelectionPosition(
      fixture.terminal,
      0,
      selectedBefore.start,
      4,
      ordinaryBefore,
      "mixed selection before earlier capacity eviction",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "selected\nordi",
      "mixed selection before earlier capacity eviction",
    );

    await fixture.ingress.push(
      encodeInput(
        update(
          fixture.contextId,
          "5",
          "growing",
          "new-1\nnew-2\nnew-3\nnew-4",
        ),
        7,
      ),
    );
    assertNoMixedErrors(fixture, "capacity-aligned earlier Block eviction");

    assertEqual(
      fixture.endpoint.range(fixture.contextId, "oldest"),
      undefined,
      "oldest rendered range after capacity trim",
    );
    const selectedAfter = requiredRange(fixture, "selected");
    const ordinaryAfter = selectedAfter.start + selectedAfter.lineCount;
    assertEqual(selectedAfter.start, 4, "selected Block after capacity trim");
    assertEqual(ordinaryAfter, 5, "retained unmanaged row after capacity trim");
    assertSelectionPosition(
      fixture.terminal,
      0,
      selectedAfter.start,
      4,
      ordinaryAfter,
      "mixed selection after earlier capacity eviction",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "selected\nordi",
      "mixed selection after earlier capacity eviction",
    );
    assertBufferRows(fixture.terminal, [
      "new-1",
      "new-2",
      "new-3",
      "new-4",
      "selected",
      "ordinary",
      "tail-1",
      "tail-2",
      "tail-3",
      "",
    ]);
    assertBlockContent(fixture, "oldest", "old-1\nold-2");
    assertBlockContent(
      fixture,
      "growing",
      "new-1\nnew-2\nnew-3\nnew-4",
    );
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after retaining the mixed selection",
    );

    return {
      name:
        "Capacity Evicts the Complete Oldest Block and Preserves a Managed-to-Unmanaged Selection",
      detail:
        "the complete oldest Block disappeared while both selection endpoints and copied text stayed attached",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runCapacityEvictsSelectedBlockAndClearsMixedSelectionScenario(): Promise<
  ScenarioResult
> {
  const fixture = await createMixedFixture({
    cols: 10,
    rows: 3,
    scrollback: 7,
  });
  try {
    await fixture.ingress.push(
      concatenate([
        encodeInput(
          append(
            fixture.contextId,
            "1",
            "oldest-selected",
            "old-1\nold-2",
            "sealed",
          ),
          3,
        ),
        text("ordinary\r\n"),
        encodeInput(
          append(fixture.contextId, "2", "growing", "draft", "mutable"),
          4,
        ),
        encodeInput(
          append(
            fixture.contextId,
            "3",
            "tail",
            "tail-1\ntail-2\ntail-3\ntail-4",
            "sealed",
          ),
          5,
        ),
      ]),
    );
    assertNoMixedErrors(fixture, "initial selected capacity stream");
    assertBufferRows(fixture.terminal, [
      "old-1",
      "old-2",
      "ordinary",
      "draft",
      "tail-1",
      "tail-2",
      "tail-3",
      "tail-4",
      "",
    ]);

    const selectedBefore = requiredRange(fixture, "oldest-selected");
    const ordinaryBefore = selectedBefore.start + selectedBefore.lineCount;
    assertEqual(
      selectedBefore.start,
      0,
      "selected oldest Block before capacity trim",
    );
    assertEqual(
      selectedBefore.lineCount,
      2,
      "selected oldest Block rows before capacity trim",
    );
    assertEqual(ordinaryBefore, 2, "selected unmanaged row before capacity trim");
    selectAcrossRows(
      fixture.terminal,
      0,
      selectedBefore.start + 1,
      4,
      ordinaryBefore,
    );
    assertSelectionPosition(
      fixture.terminal,
      0,
      selectedBefore.start + 1,
      4,
      ordinaryBefore,
      "mixed selection before selected Block capacity eviction",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "old-2\nordi",
      "mixed selection before selected Block capacity eviction",
    );

    await fixture.ingress.push(
      encodeInput(
        update(
          fixture.contextId,
          "4",
          "growing",
          "new-1\nnew-2\nnew-3\nnew-4",
        ),
        6,
      ),
    );
    assertNoMixedErrors(fixture, "capacity-aligned selected Block eviction");

    assertEqual(
      fixture.endpoint.range(fixture.contextId, "oldest-selected"),
      undefined,
      "selected oldest rendered range after capacity trim",
    );
    assertEqual(
      fixture.terminal.hasSelection(),
      false,
      "selection after its managed start is evicted",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition(),
      undefined,
      "selection position after its managed start is evicted",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "",
      "selection text after its managed start is evicted",
    );
    assertEqual(
      copySelection(fixture.terminal),
      undefined,
      "copy event after its managed start is evicted",
    );
    assertBufferRows(fixture.terminal, [
      "ordinary",
      "new-1",
      "new-2",
      "new-3",
      "new-4",
      "tail-1",
      "tail-2",
      "tail-3",
      "tail-4",
      "",
    ]);
    assertBlockContent(fixture, "oldest-selected", "old-1\nold-2");
    assertBlockContent(
      fixture,
      "growing",
      "new-1\nnew-2\nnew-3\nnew-4",
    );
    assertEqual(
      requiredRange(fixture, "growing").start,
      1,
      "growing Block start after selected Block capacity eviction",
    );
    assertEqual(
      requiredRange(fixture, "tail").start,
      5,
      "tail Block start after selected Block capacity eviction",
    );
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after clearing the evicted mixed selection",
    );

    return {
      name:
        "Capacity Evicts the Selected Managed Block and Clears the Cross-Boundary Selection",
      detail:
        "removing the managed selection start cleared the complete selection while the unmanaged row remained",
    };
  } finally {
    fixture.dispose();
  }
}
