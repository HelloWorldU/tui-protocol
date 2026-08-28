import {
  append,
  assertBlockContent,
  assertEqual,
  assertTrue,
  copySelection,
  createFixture,
  inputSnapshot,
  nextTurn,
  pushMessages,
  requiredCompositionView,
  requiredRange,
  requiredTextarea,
  update,
  write,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runSelectionAndReadingScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "earlier", "old", "mutable"),
      append(fixture.contextId, "2", "reader", "reader", "sealed"),
      append(
        fixture.contextId,
        "3",
        "selected",
        "selected-copy",
        "sealed",
      ),
      append(
        fixture.contextId,
        "4",
        "tail",
        "tail-1\ntail-2\ntail-3\ntail-4",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    const readerBefore = requiredRange(fixture, "reader");
    const selectedBefore = requiredRange(fixture, "selected");
    fixture.terminal.scrollToLine(readerBefore.start);
    fixture.terminal.select(0, selectedBefore.start, "selected-copy".length);
    assertEqual(fixture.terminal.getSelection(), "selected-copy", "selection before Update");
    assertEqual(copySelection(fixture.terminal), "selected-copy", "copy before Update");
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      readerBefore.start,
      "reading row before Update",
    );

    pushMessages(fixture.endpoint, [
      update(
        fixture.contextId,
        "5",
        "earlier",
        "new-1\nnew-2\nnew-3",
      ),
    ]);
    await fixture.endpoint.drain();

    const readerAfter = requiredRange(fixture, "reader");
    const selectedAfter = requiredRange(fixture, "selected");
    assertEqual(
      selectedAfter.start,
      selectedBefore.start + 2,
      "selected Block row after earlier growth",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      readerAfter.start,
      "reading row after earlier growth",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      selectedAfter.start,
      "selection row after earlier growth",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "selected-copy",
      "selection after OSC Update",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "selected-copy",
      "copy after OSC Update",
    );
    assertBlockContent(fixture, "earlier", "new-1\nnew-2\nnew-3");
    return {
      name: "OSC Update Preserves Reading Position and Selection",
      detail: "the later selected Block moved while its viewport row and copy text stayed intact",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runSearchScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "earlier", "old", "mutable"),
      append(
        fixture.contextId,
        "2",
        "search-result",
        "find-the-needle",
        "sealed",
      ),
      append(
        fixture.contextId,
        "3",
        "tail",
        "tail",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    assertEqual(fixture.endpoint.findNext("needle"), true, "initial search");
    const resultBefore = requiredRange(fixture, "search-result");
    assertEqual(fixture.terminal.getSelection(), "needle", "initial search match");

    pushMessages(fixture.endpoint, [
      update(
        fixture.contextId,
        "4",
        "earlier",
        "new-1\nnew-2\nnew-3",
      ),
    ]);
    await fixture.endpoint.drain();

    const resultAfter = requiredRange(fixture, "search-result");
    assertEqual(
      resultAfter.start,
      resultBefore.start + 2,
      "search-result Block row after earlier growth",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "needle",
      "current search match after OSC Update",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      resultAfter.start,
      "current search match row after OSC Update",
    );
    assertBlockContent(fixture, "earlier", "new-1\nnew-2\nnew-3");
    return {
      name: "OSC Update Preserves Current Search Match",
      detail: "the current match moved with its unchanged Block",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runActiveInputAndCompositionScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "earlier", "old", "mutable"),
      append(
        fixture.contextId,
        "2",
        "tail",
        "tail-1\ntail-2\ntail-3",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    await write(fixture.terminal, "> draft command");
    await write(fixture.terminal, "\u001b[8D");
    fixture.terminal.focus();
    const inputBefore = inputSnapshot(fixture.terminal);
    const textarea = requiredTextarea(fixture.terminal);
    const compositionView = requiredCompositionView(fixture.terminal);
    let compositionEndCount = 0;
    let dataSent = "";
    textarea.addEventListener("compositionend", () => {
      compositionEndCount += 1;
    });
    const dataRegistration = fixture.terminal.onData((data) => {
      dataSent += data;
    });

    textarea.value = "";
    textarea.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );
    textarea.value = "拼";
    textarea.dispatchEvent(
      new CompositionEvent("compositionupdate", { bubbles: true, data: "拼" }),
    );
    await nextTurn();

    pushMessages(fixture.endpoint, [
      update(
        fixture.contextId,
        "3",
        "earlier",
        "new-1\nnew-2\nnew-3",
      ),
    ]);
    await fixture.endpoint.drain();
    await nextTurn();

    const inputAfter = inputSnapshot(fixture.terminal);
    assertEqual(inputAfter.text, inputBefore.text, "active input text after OSC Update");
    assertEqual(inputAfter.cursorX, inputBefore.cursorX, "input cursor after OSC Update");
    assertEqual(inputAfter.focused, true, "input focus after OSC Update");
    assertTrue(
      inputAfter.absoluteRow > inputBefore.absoluteRow,
      "active input moved below the taller history",
    );
    assertEqual(compositionEndCount, 0, "compositionend events during OSC Update");
    assertEqual(dataSent, "", "input data sent during OSC Update");
    assertEqual(textarea.value, "拼", "textarea value during composition");
    assertEqual(compositionView.textContent, "拼", "composition view text");
    assertTrue(
      compositionView.classList.contains("active"),
      "composition view after OSC Update",
    );
    assertBlockContent(fixture, "earlier", "new-1\nnew-2\nnew-3");

    textarea.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "拼" }),
    );
    await nextTurn();
    dataRegistration.dispose();
    return {
      name: "OSC Update Preserves Active Input and Composition",
      detail: "the input text, cursor, focus, and synthetic composition stayed active",
    };
  } finally {
    fixture.dispose();
  }
}
