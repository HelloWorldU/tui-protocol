import "./styled-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { bakedBreaks, compareLayout, logicalLines, renderAt, terminalRows, type NativeRow } from "./wrap-experiment.ts";
import { WRAP_SAMPLE } from "./wrap-sample.ts";

// Pi 0.87.1's AssistantMessageComponent on the fixed markdown sample. Each
// check appends one render as a sealed text/styled Block through the xterm
// endpoint at 60 columns, optionally resizes, and compares the native rows
// with Pi's own layout at the display width.
const wide = renderAt(WRAP_SAMPLE, 1000);
const baked60 = renderAt(WRAP_SAMPLE, 60);
const shown = (spans: Parameters<typeof terminalRows>[0], display: number) =>
  terminalRows(spans, 60, ...(display === 60 ? [] : [display]));
const texts = (rows: readonly NativeRow[]) => rows.map(row => row.text);

test("a render taken at the display width reproduces Pi's own layout row for row", async () => {
  const native = await shown(baked60, 60);
  assert.deepEqual(texts(native), logicalLines(baked60));
  assert.deepEqual(compareLayout(native, logicalLines(renderAt(WRAP_SAMPLE, 60))),
    { rows: 24, piRows: 24, matchingRows: 24, midWordSplits: 0, lostPrefixes: 0 });
});

test("Pi breaks prose at word boundaries with hanging indents, but breaks long code mid-identifier", () => {
  const narrow = logicalLines(renderAt(WRAP_SAMPLE, 36));
  assert.ok(narrow.includes("  enough to wrap onto a continuation"), "list continuation keeps a two-space indent");
  assert.ok(narrow.includes("   long enough to need a"), "numbered continuation keeps a three-space indent");
  assert.ok(narrow.includes("│ enough to wrap, so every quoted"), "quote continuation repeats the marker");
  assert.ok(narrow.includes("computeSomethingWithAVeryLongName(ar"), "code wraps by character, without its indent");
});

test("a 60-column render shown at 36 columns splits words and drops list and quote prefixes", async () => {
  const native = await shown(baked60, 36);
  assert.deepEqual(compareLayout(native, logicalLines(renderAt(WRAP_SAMPLE, 36))),
    { rows: 32, piRows: 29, matchingRows: 17, midWordSplits: 6, lostPrefixes: 3 });
  const rows = texts(native);
  // The soft wrap cuts "phrase"; the baked break then leaves a short row before "and inline code".
  assert.deepEqual(rows.slice(2, 5), ["A long prose paragraph with a bold p", "hrase that keeps going", "and inline code so that it wraps acr"]);
  assert.ok(rows.includes("ough to wrap, so every"), "a quote continuation without its marker");
});

test("a 60-column render shown at 100 columns keeps its 60-column breaks instead of using the width", async () => {
  const native = await shown(baked60, 100);
  assert.deepEqual(texts(native), logicalLines(baked60), "no row grows past its 60-column line");
  assert.equal(native.length - logicalLines(renderAt(WRAP_SAMPLE, 100)).length, 5, "five more rows than Pi's own layout");
});

test("a wide render carries only content line breaks, so each paragraph is one logical line", () => {
  assert.equal(bakedBreaks(baked60, wide), 6, "the 60-column render adds six width breaks");
  assert.equal(bakedBreaks(renderAt(WRAP_SAMPLE, 36), wide), 11, "the 36-column render adds eleven");
  const lines = logicalLines(wide);
  assert.ok(lines.includes(
    "A long prose paragraph with a bold phrase that keeps going and inline code so that it wraps across several rows at narrow widths.",
  ), "copy of the paragraph yields one line");
  assert.ok(lines.includes("  const longCodeLine = computeSomethingWithAVeryLongName(argumentOne, argumentTwo);"));
});

test("terminal reflow of a wide render splits words and drops continuation prefixes at every narrower width", async () => {
  assert.deepEqual(compareLayout(await shown(wide, 60), logicalLines(baked60)),
    { rows: 25, piRows: 24, matchingRows: 13, midWordSplits: 6, lostPrefixes: 3 });
  assert.deepEqual(compareLayout(await shown(wide, 36), logicalLines(renderAt(WRAP_SAMPLE, 36))),
    { rows: 31, piRows: 29, matchingRows: 13, midWordSplits: 11, lostPrefixes: 6 });
  const rows = texts(await shown(wide, 60));
  assert.ok(rows.includes("tinuation line at sixty columns."), "a bullet continuation at column 0, mid-word");
  assert.ok(rows.includes("uoted row needs its prefix."), "a quote continuation without its marker");
});

test("a horizontal rule rendered at a fixed length spills onto extra rows on a narrower display", async () => {
  const rule = (rows: readonly NativeRow[]) => rows.filter(row => row.text.startsWith("─")).map(row => row.text.length);
  assert.deepEqual(rule(await shown(wide, 60)), [60, 20], "the wide render's 80-cell rule at 60 columns");
  assert.deepEqual(rule(await shown(baked60, 36)), [36, 24], "the 60-cell rule at 36 columns");
  assert.deepEqual(rule(await shown(wide, 36)), [36, 36, 8], "the 80-cell rule at 36 columns");
});
