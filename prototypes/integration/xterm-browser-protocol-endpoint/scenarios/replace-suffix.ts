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
  replaceSuffix,
  requiredCompositionView,
  requiredRange,
  requiredTextarea,
  write,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runReplaceSuffixRetainedSelectionAndReadingScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    const retained = "12345678901234567890keep-2";
    const initial = `${retained}-obsolete`;
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
    assertEqual(
      fixture.terminal.getSelection(),
      "keep-2",
      "selection before ReplaceSuffix",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "keep-2",
      "copy before ReplaceSuffix",
    );

    pushMessages(fixture.endpoint, [
      replaceSuffix(
        fixture.contextId,
        "3",
        "thinking",
        "1",
        retained.length,
        "-fresh-333333333333333333333",
      ),
    ]);
    await fixture.endpoint.drain();

    const thinkingAfter = requiredRange(fixture, "thinking");
    assertEqual(
      thinkingAfter.lineCount,
      thinkingBefore.lineCount + 1,
      "thinking Block rows after ReplaceSuffix",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      thinkingAfter.start + 1,
      "retained reading row after ReplaceSuffix",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "keep-2",
      "retained-prefix selection after ReplaceSuffix",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      thinkingAfter.start + 1,
      "retained-prefix selection row after ReplaceSuffix",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "keep-2",
      "retained-prefix copy after ReplaceSuffix",
    );
    assertBlockContent(
      fixture,
      "thinking",
      `${retained}-fresh-333333333333333333333`,
    );
    return {
      name: "OSC ReplaceSuffix Preserves Retained Reading Position and Selection",
      detail: "the retained row and copied prefix stayed unchanged as the suffix grew",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runReplaceSuffixRemovedSelectionScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    const prefix = "prefix";
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "thinking",
        `${prefix} obsolete`,
        "mutable",
      ),
    ]);
    await fixture.endpoint.drain();

    const thinking = requiredRange(fixture, "thinking");
    fixture.terminal.select(
      `${prefix} `.length,
      thinking.start,
      "obsolete".length,
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "obsolete",
      "removed-suffix selection before ReplaceSuffix",
    );

    pushMessages(fixture.endpoint, [
      replaceSuffix(
        fixture.contextId,
        "2",
        "thinking",
        "1",
        prefix.length,
        " fresh",
      ),
    ]);
    await fixture.endpoint.drain();

    assertEqual(
      fixture.terminal.hasSelection(),
      false,
      "selection after its suffix is replaced",
    );
    assertEqual(
      copySelection(fixture.terminal),
      undefined,
      "copy after its suffix is replaced",
    );
    assertBlockContent(fixture, "thinking", `${prefix} fresh`);
    return {
      name: "OSC ReplaceSuffix Clears a Removed-Suffix Selection",
      detail: "the old suffix stopped being a selection and copy source",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runReplaceSuffixSearchScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    const retained = "stable";
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "thinking",
        `${retained} obsolete`,
        "mutable",
      ),
    ]);
    await fixture.endpoint.drain();

    assertEqual(
      fixture.endpoint.findNext(retained),
      true,
      "retained-prefix search before ReplaceSuffix",
    );

    pushMessages(fixture.endpoint, [
      replaceSuffix(
        fixture.contextId,
        "2",
        "thinking",
        "1",
        retained.length,
        " fresh",
      ),
    ]);
    await fixture.endpoint.drain();

    assertEqual(
      fixture.terminal.getSelection(),
      retained,
      "retained-prefix current match after ReplaceSuffix",
    );
    assertEqual(
      fixture.endpoint.findNext("obsolete"),
      false,
      "removed-text search after ReplaceSuffix",
    );
    assertEqual(
      fixture.endpoint.findNext("fresh"),
      true,
      "replacement-text search after ReplaceSuffix",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "fresh",
      "replacement-text current match after ReplaceSuffix",
    );
    assertBlockContent(fixture, "thinking", `${retained} fresh`);
    return {
      name: "OSC ReplaceSuffix Updates Searchable Suffix Text",
      detail: "the retained match survived, the old suffix disappeared, and the replacement was found",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runReplaceSuffixActiveInputAndCompositionScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "thinking",
        "thinking-streaming",
        "mutable",
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
      replaceSuffix(
        fixture.contextId,
        "3",
        "thinking",
        "1",
        "thinking".length,
        "-final\nanswer",
      ),
    ]);
    await fixture.endpoint.drain();
    await nextTurn();

    const inputAfter = inputSnapshot(fixture.terminal);
    assertEqual(
      inputAfter.text,
      inputBefore.text,
      "active input text after ReplaceSuffix",
    );
    assertEqual(
      inputAfter.cursorX,
      inputBefore.cursorX,
      "input cursor after ReplaceSuffix",
    );
    assertEqual(inputAfter.focused, true, "input focus after ReplaceSuffix");
    assertTrue(
      inputAfter.absoluteRow > inputBefore.absoluteRow,
      "active input moved below the taller replacement suffix",
    );
    assertEqual(
      compositionEndCount,
      0,
      "compositionend events during ReplaceSuffix",
    );
    assertEqual(dataSent, "", "input data sent during ReplaceSuffix");
    assertEqual(textarea.value, "拼", "textarea value during ReplaceSuffix");
    assertEqual(
      compositionView.textContent,
      "拼",
      "composition view text during ReplaceSuffix",
    );
    assertTrue(
      compositionView.classList.contains("active"),
      "composition view after ReplaceSuffix",
    );
    assertBlockContent(fixture, "thinking", "thinking-final\nanswer");

    textarea.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "拼" }),
    );
    await nextTurn();
    dataRegistration.dispose();
    return {
      name: "OSC ReplaceSuffix Preserves Active Input and Composition",
      detail: "the input text, cursor, focus, and synthetic composition stayed active",
    };
  } finally {
    fixture.dispose();
  }
}
