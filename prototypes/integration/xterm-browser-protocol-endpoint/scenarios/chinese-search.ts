import {
  append, assertBlockContent, assertEqual, copySelection, createFixture,
  extend, pushMessages, replaceSuffix, requiredRange, update,
} from "../scenario-harness.ts";
import type { Fixture, ScenarioResult } from "../scenario-harness.ts";

export async function runChineseSearchReflowScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 8 });
  try {
    const raw = "中文\t结果文字";
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", raw, "mutable")]);
    await fixture.endpoint.drain();
    assertEqual(fixture.endpoint.findNext("文字"), true, "initial Chinese search");
    assertMatch(fixture, "text", "文字", [0, 12, 0, 16]);

    // At five columns, 文 and 字 are on different rows with one unused cell
    // after 文. That padding is neither a searched space nor a copied space.
    for (const [cols, coordinates] of [
      [5, [2, 2, 3, 2]],
      [9, [1, 4, 1, 8]],
      [20, [0, 12, 0, 16]],
    ] as const) {
      fixture.endpoint.resize(cols, 8);
      assertMatch(fixture, "text", "文字", coordinates);
      fixture.terminal.clearSelection();
      assertEqual(fixture.endpoint.findNext("文 字"), false, "wide-wrap padding is not searchable content");
      assertEqual(fixture.endpoint.findNext("文字"), true, "fresh search after resize to " + cols);
      assertMatch(fixture, "text", "文字", coordinates);
    }
    assertBlockContent(fixture, "text", raw);
    return {
      name: "Chinese Search Spans Wide-Character Reflow",
      detail: "the same word remained matched through 20-to-5-to-9-to-20 reflow without searching or copying wrap padding",
    };
  } finally { fixture.dispose(); }
}

export async function runChineseRepeatedSearchScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 6 });
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "earlier", "前面的内容", "mutable"),
      append(fixture.contextId, "2", "first", "中文\t结果", "sealed"),
      append(fixture.contextId, "3", "second", "中文\t结果", "sealed"),
    ]);
    await fixture.endpoint.drain();
    assertEqual(fixture.endpoint.findNext("结果"), true, "first identical match found");
    assertMatch(fixture, "first", "结果", [0, 8, 0, 12]);
    assertEqual(fixture.endpoint.findNext("结果"), true, "second identical match found");
    assertMatch(fixture, "second", "结果", [0, 8, 0, 12]);

    fixture.endpoint.resize(9, 6);
    assertMatch(fixture, "second", "结果", [1, 0, 1, 4]);
    const before = requiredRange(fixture, "second").start;
    pushMessages(fixture.endpoint, [update(fixture.contextId, "4", "earlier", "一\n二\n三")]);
    await fixture.endpoint.drain();
    assertEqual(requiredRange(fixture, "second").start, before + 1, "growing the earlier Block moves the second match down");
    assertMatch(fixture, "second", "结果", [1, 0, 1, 4]);

    pushMessages(fixture.endpoint, [update(fixture.contextId, "5", "earlier", "短")]);
    await fixture.endpoint.drain();
    assertEqual(requiredRange(fixture, "second").start, before - 1, "shrinking the earlier Block moves the second match up");
    assertMatch(fixture, "second", "结果", [1, 0, 1, 4]);
    assertBlockContent(fixture, "first", "中文\t结果");
    assertBlockContent(fixture, "second", "中文\t结果");
    return {
      name: "The Second Identical Chinese Match Stays in Its Block",
      detail: "resize and earlier-Block growth/shrinkage kept the selected second occurrence instead of switching to the first",
    };
  } finally { fixture.dispose(); }
}

export async function runChineseSearchMutationScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 9, rows: 6 });
  try {
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", "稳定\t旧文", "mutable")]);
    await fixture.endpoint.drain();
    assertEqual(fixture.endpoint.findNext("稳定"), true, "initial retained-prefix match");
    pushMessages(fixture.endpoint, [extend(fixture.contextId, "2", "text", "1", "增量")]);
    await fixture.endpoint.drain();
    assertMatch(fixture, "text", "稳定", [0, 0, 0, 4]);
    assertEqual(fixture.endpoint.findNext("增量"), true, "new Extend text is searchable");
    assertMatch(fixture, "text", "增量", [1, 4, 1, 8]);
    assertEqual(fixture.endpoint.findNext("稳定"), true, "return to the retained prefix");

    pushMessages(fixture.endpoint, [replaceSuffix(fixture.contextId, "3", "text", "2", 3, "新文")]);
    await fixture.endpoint.drain();
    assertMatch(fixture, "text", "稳定", [0, 0, 0, 4]);
    assertBlockContent(fixture, "text", "稳定\t新文");
    assertEqual(fixture.endpoint.findNext("旧文"), false, "the old suffix is absent from search");
    assertEqual(fixture.endpoint.findNext("增量"), false, "the removed extension is absent from search");
    assertEqual(fixture.endpoint.findNext("新文"), true, "the replacement suffix is searchable");
    assertMatch(fixture, "text", "新文", [1, 0, 1, 4]);

    pushMessages(fixture.endpoint, [replaceSuffix(fixture.contextId, "4", "text", "3", 3, "新词")]);
    await fixture.endpoint.drain();
    assertEqual(fixture.terminal.hasSelection(), false, "replacing the current match clears its highlight");
    assertEqual(copySelection(fixture.terminal), undefined, "the removed current match has no copy source");
    assertEqual(fixture.endpoint.findNext("新文"), false, "the replaced current match cannot be found");
    assertEqual(fixture.endpoint.findNext("新词"), true, "the new suffix can be found");
    assertMatch(fixture, "text", "新词", [1, 0, 1, 4]);

    pushMessages(fixture.endpoint, [update(fixture.contextId, "5", "text", "全新\t结果")]);
    await fixture.endpoint.drain();
    assertEqual(fixture.terminal.hasSelection(), false, "full Update clears the current match");
    assertEqual(copySelection(fixture.terminal), undefined, "full Update removes the old match's copy source");
    assertEqual(fixture.endpoint.findNext("新词"), false, "old snapshot text is not a result");
    assertEqual(fixture.endpoint.findNext("结果"), true, "new snapshot text is searchable");
    assertMatch(fixture, "text", "结果", [1, 0, 1, 4]);
    assertBlockContent(fixture, "text", "全新\t结果");
    return {
      name: "Chinese Search Tracks Current Content After Incremental and Full Updates",
      detail: "retained matches survived, new fragments became searchable, and removed matches lost their highlight and copy source",
    };
  } finally { fixture.dispose(); }
}

export async function runAdjacentChineseSearchScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 6 });
  try {
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", "中文\t结果结果", "sealed")]);
    await fixture.endpoint.drain();
    assertEqual(fixture.endpoint.findNext("结果"), true, "first adjacent occurrence");
    assertMatch(fixture, "text", "结果", [0, 8, 0, 12]);
    fixture.endpoint.resize(9, 6);
    assertMatch(fixture, "text", "结果", [1, 0, 1, 4]);
    assertEqual(fixture.endpoint.findNext("结果"), true, "next search reaches the immediately adjacent occurrence");
    assertMatch(fixture, "text", "结果", [1, 4, 1, 8]);
    fixture.endpoint.resize(20, 6);
    assertMatch(fixture, "text", "结果", [0, 12, 0, 16]);
    assertEqual(fixture.endpoint.findNext("结果"), true, "next search wraps to the first occurrence");
    assertMatch(fixture, "text", "结果", [0, 8, 0, 12]);
    return {
      name: "Adjacent Chinese Matches Are Not Skipped After Reflow",
      detail: "find-next reached the adjacent occurrence and wrapped back after a 20-to-9-to-20 resize round trip",
    };
  } finally { fixture.dispose(); }
}

/** Literal fixture coordinates, independent of the renderer's mapping helper. */
function assertMatch(
  fixture: Fixture, blockId: string, term: string,
  [startRow, startColumn, endRow, endColumn]: readonly [number, number, number, number],
): void {
  const range = requiredRange(fixture, blockId);
  const selection = fixture.terminal.getSelectionPosition();
  assertEqual(fixture.terminal.getSelection(), term, "highlight contains only the searched characters");
  assertEqual(copySelection(fixture.terminal), term, "the current match copies only the searched characters");
  assertEqual(selection?.start.y, range.start + startRow, "match starts in the intended Block row");
  assertEqual(selection?.start.x, startColumn, "match starts at the first glyph's cell");
  assertEqual(selection?.end.y, range.start + endRow, "match ends in the intended Block row");
  assertEqual(selection?.end.x, endColumn, "match ends after the last complete glyph");
}
