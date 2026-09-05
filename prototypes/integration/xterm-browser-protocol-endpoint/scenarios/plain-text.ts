import {
  append,
  assertBlockContent,
  assertEqual,
  assertNoMixedErrors,
  concatenate,
  copySelection,
  createFixture,
  createMixedFixture,
  encodeInput,
  extend,
  pushMessages,
  replaceSuffix,
  requiredRange,
  selectAcrossRows,
  text,
  update,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runPlainTextNewlineAndControlScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 40, rows: 6 });
  try {
    const raw = "one\rtwo\r\nthree\nfour\x1b[2J";
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", raw, "mutable")]);
    await fixture.endpoint.drain();
    const range = requiredRange(fixture, "text");
    selectAcrossRows(fixture.terminal, 0, range.start, 15, range.start + 3);
    assertEqual(copySelection(fixture.terminal), "one\ntwo\nthree\nfour<U+001B>[2J", "copy uses LF and a visible escape label");
    fixture.endpoint.resize(10, 6);
    assertEqual(copySelection(fixture.terminal), "one\ntwo\nthree\nfour<U+001B>[2J", "multiline selection survives reflow without copying soft wraps");
    assertEqual(fixture.endpoint.findNext("<U+001B>"), true, "the visible escape label is searchable");
    assertEqual(copySelection(fixture.terminal), "<U+001B>", "copying a control label does not reconstruct ESC");
    assertEqual(fixture.endpoint.findNext("\x1b[2J"), false, "raw escape bytes are not searchable text");
    assertBlockContent(fixture, "text", raw);
    return {
      name: "Plain Text Newlines and Control Labels",
      detail: "multiline copy kept LF through reflow and search found the visible escape label, not executable bytes",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runPlainTextTabReflowScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 6 });
  try {
    const raw = "a\tb\tc";
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", raw, "mutable")]);
    await fixture.endpoint.drain();
    fixture.terminal.select(0, requiredRange(fixture, "text").start, 17);
    assertEqual(fixture.terminal.getSelection(), "a       b       c", "selected display has expanded Tabs");
    assertEqual(copySelection(fixture.terminal), raw, "copy restores fully selected Tabs");
    fixture.endpoint.resize(6, 6);
    assertEqual(copySelection(fixture.terminal), raw, "copy retains Tabs across soft wraps after narrowing");
    fixture.endpoint.resize(20, 6);
    assertEqual(copySelection(fixture.terminal), raw, "copy retains Tabs after widening again");
    assertBlockContent(fixture, "text", raw);
    return {
      name: "Plain Text Tab Copy Through Reflow",
      detail: "fully selected Tabs copied as HT before and after narrowing and widening the viewport",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runPlainTextRetainedSelectionScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 40, rows: 6 });
  try {
    const prefix = "a\t\x1b";
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", `${prefix}old`, "mutable")]);
    await fixture.endpoint.drain();
    fixture.terminal.select(0, requiredRange(fixture, "text").start, 16);
    const copiedPrefix = "a\t<U+001B>";
    assertEqual(copySelection(fixture.terminal), copiedPrefix, "initial projected prefix copy");
    pushMessages(fixture.endpoint, [extend(fixture.contextId, "2", "text", "1", " tail")]);
    await fixture.endpoint.drain();
    assertEqual(copySelection(fixture.terminal), copiedPrefix, "Extend excludes appended text from the prefix selection");
    pushMessages(fixture.endpoint, [replaceSuffix(fixture.contextId, "3", "text", "2", 3, "\rnew")]);
    await fixture.endpoint.drain();
    assertEqual(copySelection(fixture.terminal), copiedPrefix, "ReplaceSuffix uses three raw scalars, not sixteen display cells");
    assertBlockContent(fixture, "text", `${prefix}\rnew`);
    pushMessages(fixture.endpoint, [update(fixture.contextId, "4", "text", "fresh\ttext")]);
    await fixture.endpoint.drain();
    assertEqual(fixture.terminal.hasSelection(), false, "Update clears the replaced selection");
    assertEqual(copySelection(fixture.terminal), undefined, "Update removes the old copy source");
    assertEqual(fixture.endpoint.findNext("fresh"), true, "the updated visible text is searchable");
    return {
      name: "Plain Text Raw Offsets Preserve the Displayed Prefix",
      detail: "Extend and ReplaceSuffix retained a selected Tab/control prefix; full Update cleared it",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runPlainTextPartialTabScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 6 });
  try {
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", "a\tb\tc", "mutable")]);
    await fixture.endpoint.drain();
    const row = requiredRange(fixture, "text").start;
    fixture.terminal.select(3, row, 3);
    assertEqual(copySelection(fixture.terminal), "   ", "part of one Tab copies only the selected spaces");
    fixture.terminal.select(3, row, 14);
    assertEqual(copySelection(fixture.terminal), "     b\tc", "a partial Tab stays spaces while the complete Tab copies as HT");
    fixture.endpoint.resize(6, 6);
    assertEqual(copySelection(fixture.terminal), "     b\tc", "partial and complete Tabs retain their copy result through reflow");
    pushMessages(fixture.endpoint, [update(fixture.contextId, "2", "text", "a\t")]);
    await fixture.endpoint.drain();
    fixture.terminal.select(1, requiredRange(fixture, "text").start, 7);
    assertEqual(copySelection(fixture.terminal), "\t", "a complete trailing Tab survives native right trimming");
    return {
      name: "Partial Tab Copy Does Not Expand the Selection",
      detail: "partial Tabs copied selected spaces, complete Tabs copied HT, including after reflow and at the tail",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runPlainTextMixedCopyScenario(): Promise<ScenarioResult> {
  const fixture = await createMixedFixture({ cols: 20, rows: 6 });
  try {
    await fixture.ingress.push(concatenate([
      encodeInput(append(fixture.contextId, "1", "first", "a\tb", "mutable"), 3),
      text("ordinary\r\n"),
      encodeInput(append(fixture.contextId, "2", "last", "last", "sealed"), 4),
    ]));
    assertNoMixedErrors(fixture, "projected and ordinary output");
    selectAcrossRows(fixture.terminal, 0, requiredRange(fixture, "first").start, 4, requiredRange(fixture, "last").start);
    assertEqual(copySelection(fixture.terminal), "a\tb\nordinary\nlast", "mixed copy restores only the managed Tab and preserves boundaries");
    return {
      name: "Plain Text Tab Copy Across Ordinary Output",
      detail: "copy preserved the managed Tab, the ordinary row, and one newline at each boundary",
    };
  } finally {
    fixture.dispose();
  }
}
