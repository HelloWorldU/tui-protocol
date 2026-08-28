import {
  append,
  assertBlockContent,
  assertEqual,
  assertTrue,
  copySelection,
  createFixture,
  pushMessages,
  requiredRange,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runAppendHistoryReadingAndSelectionScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "selected",
        "stay-selected",
        "sealed",
      ),
      append(
        fixture.contextId,
        "2",
        "tail",
        "tail-1\ntail-2\ntail-3\ntail-4",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    const selectedBefore = requiredRange(fixture, "selected");
    fixture.terminal.scrollToLine(selectedBefore.start);
    fixture.terminal.select(
      0,
      selectedBefore.start,
      "stay-selected".length,
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "stay-selected",
      "selection before tail Append",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      selectedBefore.start,
      "reading row before tail Append",
    );

    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "3",
        "new-tail",
        "new-1\nnew-2\nnew-3",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    const selectedAfter = requiredRange(fixture, "selected");
    const appended = requiredRange(fixture, "new-tail");
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      selectedAfter.start,
      "reading row after tail Append",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "stay-selected",
      "selection after tail Append",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      selectedAfter.start,
      "selection row after tail Append",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "stay-selected",
      "copy after tail Append",
    );
    assertTrue(
      appended.start > requiredRange(fixture, "tail").start,
      "new Block rendered after the prior tail Block",
    );
    assertBlockContent(fixture, "new-tail", "new-1\nnew-2\nnew-3");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.blocks.at(-1)?.id,
      "new-tail",
      "new Block logical append order",
    );
    return {
      name: "OSC Append Preserves History Reading and Selection",
      detail: "the existing viewport row and copy source stayed unchanged as a new tail Block appeared",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runAppendTailFollowingScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "initial-tail",
        "old-1\nold-2\nold-3\nold-4\nold-5",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();
    fixture.terminal.scrollToBottom();
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      fixture.terminal.buffer.active.baseY,
      "tail-following viewport before Append",
    );

    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "2",
        "new-tail",
        "new-1\nnew-2\nnew-3",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      fixture.terminal.buffer.active.baseY,
      "tail-following viewport after Append",
    );
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.blocks.at(-1)?.id,
      "new-tail",
      "tail-followed Block append order",
    );
    assertBlockContent(fixture, "new-tail", "new-1\nnew-2\nnew-3");
    return {
      name: "OSC Append Preserves Tail Following",
      detail: "the viewport followed the newly appended logical tail",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runAppendSearchScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "existing-search",
        "stable match",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();
    assertEqual(
      fixture.endpoint.findNext("stable"),
      true,
      "existing search before Append",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "stable",
      "existing current match before Append",
    );

    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "2",
        "appended-search",
        "append-match",
        "mutable",
      ),
    ]);
    await fixture.endpoint.drain();

    assertEqual(
      fixture.terminal.getSelection(),
      "stable",
      "existing current match after Append",
    );
    assertEqual(
      fixture.endpoint.findNext("append-match"),
      true,
      "new Block search after Append",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "append-match",
      "new Block current match after Append",
    );
    assertBlockContent(fixture, "appended-search", "append-match");
    return {
      name: "OSC Append Adds Searchable Tail Content",
      detail: "the existing match survived and the new Block became searchable",
    };
  } finally {
    fixture.dispose();
  }
}
