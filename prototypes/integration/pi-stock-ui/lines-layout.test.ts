import "./styled-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { layoutLines, rowText } from "../../line-layout/layout.ts";
import { linesFromRender, splitLines } from "./lines-from-render.ts";
import { compareLayout, logicalLines, renderAt, terminalRows } from "./wrap-experiment.ts";
import { CJK_NESTED_SAMPLE, WRAP_SAMPLE } from "./wrap-sample.ts";

// RFC 0003 evidence: Pi's wide render converted to text/lines, laid out by the
// line-layout engine at each width, against Pi's own render at that width.
const lines = linesFromRender(renderAt(WRAP_SAMPLE, 1000));

test("the wide render converts to one text/lines line per content line, with recovered layout intent", () => {
  assert.equal(lines.length, 18);
  const byText = (start: string) => lines.find(line => line.spans.map(span => span.text).join("").startsWith(start));
  assert.deepEqual(byText("- A bullet")?.continuation, [{ text: "  " }]);
  assert.deepEqual(byText("1. A numbered")?.continuation, [{ text: "   " }]);
  assert.deepEqual(byText("│ A quoted")?.continuation, [{ text: "│ ", style: { foreground: { rgb: [128, 128, 128] } } }]);
  assert.equal(lines.filter(line => line.fill).length, 1, "the rule becomes a fill line");
});

for (const cols of [36, 60]) {
  test(`laid out at ${cols} columns, text/lines reproduces Pi's own render row for row, styles included`, () => {
    const pi = splitLines(renderAt(WRAP_SAMPLE, cols));
    assert.deepEqual(layoutLines(lines, cols).map(row => row.spans), pi);
  });
}

test("at 100 columns the only difference is Pi capping its rule at 80 cells while the fill line spans the width", () => {
  const ours = layoutLines(lines, 100).map(rowText);
  const pi = logicalLines(renderAt(WRAP_SAMPLE, 100));
  const differing = ours.flatMap((row, index) => (row === pi[index] ? [] : [index]));
  assert.equal(ours.length, pi.length);
  assert.deepEqual(differing.map(index => [ours[index]!.length, pi[index]!.length]), [[100, 80]]);
});

test("soft breaks fall at spaces except inside the one code identifier wider than a 36-column row", () => {
  // A break at a space skips the dropped space, so the next row starts past the previous end.
  const cellBreaks = (cols: number) => {
    const rows = layoutLines(lines, cols);
    return rows.flatMap((row, index) => (row.soft && row.start === rows[index - 1]!.end ? [rowText(row)] : []));
  };
  assert.deepEqual(cellBreaks(60), []);
  assert.deepEqual(cellBreaks(36), ["gumentOne, argumentTwo);"], "Pi breaks the same over-long word between cells");
});

test("cell reflow of the same wide render keeps far fewer of Pi's rows than text/lines layout", async () => {
  for (const [cols, kept] of [[36, 13], [60, 13]] as const) {
    const reflowed = compareLayout(await terminalRows(renderAt(WRAP_SAMPLE, 1000), 60, ...(cols === 60 ? [] : [cols])), logicalLines(renderAt(WRAP_SAMPLE, cols)));
    assert.equal(reflowed.matchingRows, kept, `${cols}: cell reflow kept ${kept} rows`);
    assert.equal(layoutLines(lines, cols).length, reflowed.piRows, `${cols}: text/lines has exactly Pi's row count`);
  }
});

/** Widths from 20 to 100 where the laid-out rows differ from Pi's own render. */
function differingWidths(sample: string): Map<number, { ours: string[]; pi: string[] }> {
  const sampleLines = linesFromRender(renderAt(sample, 1000));
  const result = new Map<number, { ours: string[]; pi: string[] }>();
  for (let cols = 20; cols <= 100; cols++) {
    const ours = layoutLines(sampleLines, cols).map(rowText);
    const pi = logicalLines(renderAt(sample, cols));
    if (ours.length !== pi.length || ours.some((row, index) => row !== pi[index])) result.set(cols, { ours, pi });
  }
  return result;
}

test("Chinese, mixed Chinese and English, nested lists, and a Chinese quote match Pi's render at every width from 20 to 100", () => {
  assert.deepEqual([...differingWidths(CJK_NESTED_SAMPLE).keys()], []);
  const narrow = layoutLines(linesFromRender(renderAt(CJK_NESTED_SAMPLE, 1000)), 36).map(rowText);
  assert.ok(narrow.includes("      to wrap onto a continuation"), "a second-level bullet continues under its text");
  assert.ok(narrow.includes("       enough to wrap at narrow"), "a nested numbered item continues under its text");
  assert.ok(narrow.includes("│ 记，宽度变化时不能丢。"), "a Chinese quote repeats its marker");
});

test("the English sample matches Pi at every width from 20 to 100 except the rule cap and Pi's leading space after a style boundary", () => {
  const differing = differingWidths(WRAP_SAMPLE);
  const ruleOnly = [...differing].filter(([, { ours, pi }]) =>
    ours.every((row, index) => row === pi[index] || (row.startsWith("─") && pi[index] === "─".repeat(80))));
  assert.deepEqual(ruleOnly.map(([cols]) => cols), Array.from({ length: 20 }, (_, index) => 81 + index), "above 80 columns only the rule");
  const other = [...differing.keys()].filter(cols => cols <= 80);
  assert.deepEqual(other, [21, 39, 58, 74]);
  for (const cols of other) {
    // Pi keeps the space at a break that falls right after a styled span; the engine drops it.
    assert.ok(differing.get(cols)!.pi.some(row => row.startsWith(" ") && !row.startsWith("  ")), `${cols}: Pi has a row starting with one space`);
    assert.ok(!differing.get(cols)!.ours.some(row => /^ [^ ]/.test(row)), `${cols}: the engine starts no row with a dropped space`);
  }
});

test("cell reflow of the Chinese and nested-list sample loses Pi's layout as it did for English", async () => {
  const pi36 = logicalLines(renderAt(CJK_NESTED_SAMPLE, 36));
  const wide = compareLayout(await terminalRows(renderAt(CJK_NESTED_SAMPLE, 1000), 60, 36), pi36);
  const baked = compareLayout(await terminalRows(renderAt(CJK_NESTED_SAMPLE, 60), 60, 36), pi36);
  assert.deepEqual([wide.matchingRows, baked.matchingRows, pi36.length], [13, 12, 26]);
  assert.equal(wide.lostPrefixes, 2);
});
