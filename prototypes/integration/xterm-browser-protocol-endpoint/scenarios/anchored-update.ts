import {
  append, assertBlockContent, assertBufferRows, assertEqual, assertSelectionAndCopy,
  assertTrue, copySelection, createFixture, extend, pushMessages, requiredRange, update,
  assertNoMixedErrors, concatenate, createMixedFixture, encodeInput, text,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runAnchoredUpdateSelectionScenario(selectTarget: boolean): Promise<ScenarioResult> {
  const fixture = createFixture();
  const { terminal, endpoint, contextId } = fixture;
  const tail = ["tail-1", "tail-2", "tail-3", "tail-4"];
  try {
    pushMessages(endpoint, [
      append(contextId, "1", "before", "before", "sealed"),
      append(contextId, "2", "target", "old-1\nold-2\nold-3", "mutable"),
      append(contextId, "3", "tail", tail.join("\n"), "sealed"),
    ]);
    await endpoint.drain();
    const replacements = ["new-1\nnew-2\nnew-3\nnew-4", "final", ""];
    for (const [index, replacement] of replacements.entries()) {
      const target = requiredRange(fixture, "target");
      const selected = selectTarget ? target : requiredRange(fixture, "tail");
      // No selection is manufactured in an empty Block: emptiness is the final result.
      terminal.select(0, selected.start, selectTarget ? 3 : 6);
      assertTrue(terminal.hasSelection(), "selection before Update");
      terminal.scrollToLine(target.start + (index === 0 ? 1 : 0));
      assertTrue(terminal.buffer.active.viewportY < terminal.buffer.active.baseY, "reading history before Update");
      pushMessages(endpoint, [update(contextId, String(4 + index), "target", replacement)]);
      await endpoint.drain();

      const rows = replacement.split("\n");
      assertBlockContent(fixture, "target", replacement);
      assertBufferRows(terminal, ["before", ...rows, ...tail, ""]);
      assertEqual(terminal.buffer.active.viewportY, 1, "reading moves to replacement start");
      assertTrue(terminal.buffer.active.viewportY < terminal.buffer.active.baseY, "reading does not jump to tail");
      assertEqual(requiredRange(fixture, "tail").start, 1 + rows.length, "later Block range");
      if (selectTarget) {
        assertEqual(terminal.hasSelection(), false, "replaced selection cleared");
        assertEqual(terminal.getSelection(), "", "old selected text removed");
        assertEqual(copySelection(terminal), undefined, "old copy source removed");
      } else {
        assertSelectionAndCopy(terminal, "tail-1", "unaffected selection after Update");
        assertEqual(terminal.getSelectionPosition()?.start.y, 1 + rows.length, "selection moved with later Block");
      }
    }
    pushMessages(endpoint, [extend(contextId, "7", "target", "6", "continued")]);
    await endpoint.drain();
    assertBlockContent(fixture, "target", "continued");
    assertBufferRows(terminal, ["before", "continued", ...tail, ""]);
    endpoint.resize(10, 4);
    assertEqual(terminal.buffer.active.viewportY, requiredRange(fixture, "target").start, "replacement anchor survives resize");
    // Explicit searches happen after the reading assertions; search may scroll.
    assertEqual(endpoint.findNext("old-2"), false, "replaced content is not searchable");
    assertEqual(endpoint.findNext("continued"), true, "new content is searchable");
    return {
      name: selectTarget ? "Update of the Block Being Read Clears Its Selection" : "Update of the Block Being Read Preserves a Later Selection",
      detail: "growth, shrinkage, and empty replacement rendered without stale rows; reading used the replacement start and later Extend succeeded",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runAnchoredUpdateShortScreenScenario(): Promise<ScenarioResult> {
  const fixture = await createMixedFixture({ rows: 4 });
  const { terminal, contextId, ingress } = fixture;
  try {
    await ingress.push(concatenate([
      encodeInput(append(contextId, "1", "before", "before", "sealed"), 1),
      encodeInput(append(contextId, "2", "target", "a\nb\nc\nd\ne\nf", "mutable"), 2),
    ]));
    assertNoMixedErrors(fixture, "initial content");
    terminal.scrollToLine(2);
    assertTrue(terminal.buffer.active.viewportY < terminal.buffer.active.baseY, "history reading before shrink");
    await ingress.push(concatenate([
      encodeInput(update(contextId, "3", "target", ""), 3),
      text("input"),
    ]));
    assertNoMixedErrors(fixture, "Update then ordinary output");
    assertBlockContent(fixture, "target", "");
    assertBufferRows(terminal, ["before", "", "input", ""]);
    assertEqual(terminal.buffer.active.viewportY, 0, "clamped reading position");
    assertEqual(terminal.buffer.active.baseY, 0, "no remaining scrollback");
    assertEqual(terminal.buffer.active.cursorY, 2, "ordinary output follows empty Block");
    assertEqual(terminal.buffer.active.cursorX, 5, "ordinary output advances native cursor");
    return {
      name: "Update of the Block Being Read Shrinks Below One Screen",
      detail: "the viewport clamped, blank screen rows remained, and following ordinary output used the corrected cursor row",
    };
  } finally {
    fixture.dispose();
  }
}
