import {
  append,
  assertBlockContent,
  assertEqual,
  assertInputStateUnchanged,
  assertTrue,
  copySelection,
  createFixture,
  inputSnapshot,
  nextTurn,
  pushMessages,
  requiredRange,
  update,
  write,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runResizeReadingSelectionAndUpdateScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 4 });
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "earlier",
        "1234567890ABCDEF",
        "mutable",
      ),
      append(fixture.contextId, "2", "reader", "later", "sealed"),
      append(
        fixture.contextId,
        "3",
        "tail",
        "tail-1\ntail-2\ntail-3\ntail-4",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    const readerBefore = requiredRange(fixture, "reader");
    fixture.terminal.scrollToLine(readerBefore.start);
    fixture.terminal.select(0, readerBefore.start, "later".length);

    fixture.endpoint.resize(10, 4);

    const readerAfterResize = requiredRange(fixture, "reader");
    assertTrue(
      readerAfterResize.start > readerBefore.start,
      "reader Block moved after an earlier Block reflowed",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      readerAfterResize.start,
      "reading row after resize",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "later",
      "selection after resize",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      readerAfterResize.start,
      "selection row after resize",
    );
    assertEqual(copySelection(fixture.terminal), "later", "copy after resize");

    pushMessages(fixture.endpoint, [
      update(fixture.contextId, "4", "earlier", "short"),
    ]);
    await fixture.endpoint.drain();

    const readerAfterUpdate = requiredRange(fixture, "reader");
    assertTrue(
      readerAfterUpdate.start < readerAfterResize.start,
      "reader Block moved back after the resized earlier Block shrank",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      readerAfterUpdate.start,
      "reading row after post-resize Update",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "later",
      "selection after post-resize Update",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      readerAfterUpdate.start,
      "selection row after post-resize Update",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "later",
      "copy after post-resize Update",
    );
    assertBlockContent(fixture, "earlier", "short");
    assertBlockContent(fixture, "reader", "later");
    return {
      name: "Browser Resize Preserves Reading and Selection Through a Later Update",
      detail: "the selected reader row followed reflow and a subsequent OSC Update without changing its copy text",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runResizeSearchScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 4 });
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "earlier",
        "1234567890ABCDEF",
        "sealed",
      ),
      append(
        fixture.contextId,
        "2",
        "search-result",
        "persistent match",
        "sealed",
      ),
      append(
        fixture.contextId,
        "3",
        "tail",
        "tail-1\ntail-2\ntail-3",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();
    assertEqual(
      fixture.endpoint.findNext("persistent"),
      true,
      "current search before resize",
    );
    const resultBefore = requiredRange(fixture, "search-result");

    fixture.endpoint.resize(10, 4);

    const resultAfter = requiredRange(fixture, "search-result");
    assertTrue(
      resultAfter.start > resultBefore.start,
      "search-result Block moved after earlier reflow",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "persistent",
      "current search match after resize",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      resultAfter.start,
      "current search match row after resize",
    );
    assertBlockContent(fixture, "search-result", "persistent match");
    return {
      name: "Browser Resize Preserves the Current Search Match",
      detail: "the current match moved with its Block when earlier content reflowed",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runResizeActiveInputScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 4 });
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "history",
        "1234567890ABCDEF",
        "sealed",
      ),
      append(
        fixture.contextId,
        "2",
        "tail",
        "tail-1\ntail-2\ntail-3",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();
    await write(fixture.terminal, "> edit");
    await write(fixture.terminal, "\u001b[2D");
    fixture.terminal.focus();
    const inputBefore = inputSnapshot(fixture.terminal);

    fixture.endpoint.resize(10, 4);
    await nextTurn();

    const inputAfter = inputSnapshot(fixture.terminal);
    assertInputStateUnchanged(inputAfter, inputBefore, "active input after resize");
    assertTrue(
      inputAfter.absoluteRow > inputBefore.absoluteRow,
      "active input moved below reflowed history",
    );
    assertBlockContent(fixture, "history", "1234567890ABCDEF");
    return {
      name: "Browser Resize Preserves Active Input",
      detail: "the input moved physically while keeping its text, cursor, and focus",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runResizeTailFollowingScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 4 });
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "history",
        "1234567890ABCDEF",
        "sealed",
      ),
      append(
        fixture.contextId,
        "2",
        "tail",
        "tail-1\ntail-2\ntail-3\ntail-4\ntail-5",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();
    fixture.terminal.scrollToBottom();
    const baseBefore = fixture.terminal.buffer.active.baseY;

    fixture.endpoint.resize(10, 4);

    assertTrue(
      fixture.terminal.buffer.active.baseY > baseBefore,
      "terminal history grew after resize reflow",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      fixture.terminal.buffer.active.baseY,
      "tail-following viewport after resize",
    );
    assertBlockContent(fixture, "history", "1234567890ABCDEF");
    return {
      name: "Browser Resize Preserves Tail Following",
      detail: "the viewport remained at the logical tail after reflow added rows",
    };
  } finally {
    fixture.dispose();
  }
}
