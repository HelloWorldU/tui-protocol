import {
  append,
  assertBlockContent,
  assertEqual,
  assertTrue,
  copySelection,
  createFixture,
  extend,
  inputSnapshot,
  nextTurn,
  pushMessages,
  requiredCompositionView,
  requiredRange,
  requiredTextarea,
  write,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runExtendSelectionAndReadingScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    const initial = "keep-1\nkeep-2\nkeep-3";
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "thinking", initial, "mutable"),
      append(
        fixture.contextId,
        "2",
        "tail",
        "tail-1\ntail-2\ntail-3\ntail-4",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    const thinkingBefore = requiredRange(fixture, "thinking");
    fixture.terminal.scrollToLine(thinkingBefore.start + 1);
    fixture.terminal.select(0, thinkingBefore.start + 1, "keep-2".length);
    assertEqual(fixture.terminal.getSelection(), "keep-2", "selection before Extend");
    assertEqual(copySelection(fixture.terminal), "keep-2", "copy before Extend");

    pushMessages(fixture.endpoint, [
      extend(
        fixture.contextId,
        "3",
        "thinking",
        "1",
        "\nnew-4\nnew-5",
      ),
    ]);
    await fixture.endpoint.drain();

    const thinkingAfter = requiredRange(fixture, "thinking");
    assertEqual(
      thinkingAfter.lineCount,
      thinkingBefore.lineCount + 2,
      "thinking Block rows after Extend",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      thinkingAfter.start + 1,
      "retained reading row after Extend",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "keep-2",
      "retained selection after Extend",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      thinkingAfter.start + 1,
      "retained selection row after Extend",
    );
    assertEqual(copySelection(fixture.terminal), "keep-2", "copy after Extend");
    assertBlockContent(fixture, "thinking", `${initial}\nnew-4\nnew-5`);
    return {
      name: "OSC Extend Preserves Existing Reading Position and Selection",
      detail: "the retained row and copied text stayed unchanged as the Block grew",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runExtendSearchScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "thinking",
        "stable needle",
        "mutable",
      ),
    ]);
    await fixture.endpoint.drain();

    assertEqual(fixture.endpoint.findNext("needle"), true, "search before Extend");
    assertEqual(fixture.terminal.getSelection(), "needle", "current match before Extend");

    pushMessages(fixture.endpoint, [
      extend(
        fixture.contextId,
        "2",
        "thinking",
        "1",
        " and new-token",
      ),
    ]);
    await fixture.endpoint.drain();

    assertEqual(
      fixture.terminal.getSelection(),
      "needle",
      "existing current match after Extend",
    );
    assertEqual(
      fixture.endpoint.findNext("new-token"),
      true,
      "appended-text search after Extend",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "new-token",
      "appended-text current match",
    );
    assertBlockContent(
      fixture,
      "thinking",
      "stable needle and new-token",
    );
    return {
      name: "OSC Extend Preserves and Adds Searchable Text",
      detail: "the old match survived and the appended fragment became searchable",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runExtendActiveInputAndCompositionScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "thinking", "old", "mutable"),
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
      extend(
        fixture.contextId,
        "3",
        "thinking",
        "1",
        "\nnew-2\nnew-3",
      ),
    ]);
    await fixture.endpoint.drain();
    await nextTurn();

    const inputAfter = inputSnapshot(fixture.terminal);
    assertEqual(inputAfter.text, inputBefore.text, "active input text after Extend");
    assertEqual(inputAfter.cursorX, inputBefore.cursorX, "input cursor after Extend");
    assertEqual(inputAfter.focused, true, "input focus after Extend");
    assertTrue(
      inputAfter.absoluteRow > inputBefore.absoluteRow,
      "active input moved below the extended history",
    );
    assertEqual(compositionEndCount, 0, "compositionend events during Extend");
    assertEqual(dataSent, "", "input data sent during Extend");
    assertEqual(textarea.value, "拼", "textarea value during Extend");
    assertEqual(compositionView.textContent, "拼", "composition view text during Extend");
    assertTrue(
      compositionView.classList.contains("active"),
      "composition view after Extend",
    );
    assertBlockContent(fixture, "thinking", "old\nnew-2\nnew-3");

    textarea.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "拼" }),
    );
    await nextTurn();
    dataRegistration.dispose();
    return {
      name: "OSC Extend Preserves Active Input and Composition",
      detail: "the input text, cursor, focus, and synthetic composition stayed active",
    };
  } finally {
    fixture.dispose();
  }
}
