import assert from "node:assert/strict";
import test from "node:test";
import type { LinesTextLine } from "@tui-protocol/sdk";
import { contentText, extendedContent, replacedSuffixContent } from "@tui-protocol/terminal";
import { linesEdit, type LinesEdit } from "./lines-edit.ts";

const plain = (text: string, extra: Omit<LinesTextLine, "spans"> = {}): LinesTextLine => ({ spans: [{ text }], ...extra });
const bullet = (text: string) => plain(text, { continuation: [{ text: "  " }] });

/** Applies an edit with the terminal module's own content rules. */
function apply(previous: readonly LinesTextLine[], edit: LinesEdit, next: readonly LinesTextLine[]) {
  const content = { type: "text/lines" as const, data: previous };
  switch (edit.kind) {
    case "none": return content;
    case "extend": return extendedContent(content, edit.fragment);
    case "replaceSuffix": return replacedSuffixContent(content, edit.retain, edit.replacement);
    case "update": return { type: "text/lines" as const, data: next };
  }
}

function assertReaches(previous: LinesTextLine[], next: LinesTextLine[], kind: LinesEdit["kind"]) {
  const edit = linesEdit(previous, next);
  assert.equal(edit.kind, kind);
  const result = apply(previous, edit, next);
  assert.equal(contentText(result), contentText({ type: "text/lines", data: next }), "same logical text");
  // Lines may differ only in how spans are split; compare each line's text and attributes.
  const shape = (lines: readonly LinesTextLine[]) => lines.map(line => [line.spans.map(span => span.text).join(""), line.wrap, line.continuation, line.fill]);
  assert.deepEqual(shape(result.data as LinesTextLine[]), shape(next));
  return edit;
}

test("unchanged lines need no Operation", () => {
  assert.deepEqual(linesEdit([plain("a")], [plain("a")]), { kind: "none" });
});

test("text streaming onto the last line is one Extend with the tail", () => {
  const edit = assertReaches([plain("Hello")], [plain("Hello, world")], "extend");
  assert.deepEqual(edit, { kind: "extend", fragment: [{ spans: [{ text: ", world" }] }] });
});

test("new lines after unchanged lines are an Extend starting with an empty continuation", () => {
  const edit = assertReaches([plain("one")], [plain("one"), plain(""), bullet("- two")], "extend");
  assert.deepEqual(edit.kind === "extend" ? edit.fragment[0] : undefined, { spans: [] });
});

test("a restyled earlier span becomes a ReplaceSuffix at the shared span prefix", () => {
  const previous = [{ spans: [{ text: "keep " }, { text: "**bold" }] }];
  const next = [{ spans: [{ text: "keep " }, { text: "bold", style: { bold: true } }] }];
  const edit = assertReaches(previous, next, "replaceSuffix");
  assert.equal(edit.kind === "replaceSuffix" ? edit.retain : -1, 5);
});

test("a line whose attributes change is replaced from the end of the previous line", () => {
  // Streaming "- it" first renders as a paragraph, then as a bullet item.
  const edit = assertReaches([plain("intro"), plain("- it")], [plain("intro"), bullet("- item")], "replaceSuffix");
  assert.deepEqual(edit, { kind: "replaceSuffix", retain: 5, replacement: [{ spans: [] }, bullet("- item")] });
});

test("removed trailing lines are a ReplaceSuffix with an empty replacement", () => {
  const edit = assertReaches([plain("a"), plain("b"), plain("c")], [plain("a")], "replaceSuffix");
  assert.deepEqual(edit, { kind: "replaceSuffix", retain: 1, replacement: [] });
});

test("only a change to the first line's attributes needs an Update", () => {
  assert.equal(linesEdit([plain("- a")], [bullet("- a")]).kind, "update");
  assert.equal(linesEdit([plain("─", { fill: true })], [plain("x")]).kind, "update");
});

test("an edited middle line keeps earlier lines and replaces from inside the line", () => {
  const edit = assertReaches([plain("first"), plain("second line"), plain("third")], [plain("first"), plain("second LINE"), plain("third")], "replaceSuffix");
  assert.equal(edit.kind === "replaceSuffix" ? edit.retain : -1, 6, "single-span lines share no whole span, so the line restarts");
});
