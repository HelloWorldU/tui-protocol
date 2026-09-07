import {
  append, assertBlockContent, assertEqual, copySelection, createFixture,
  extend, pushMessages, replaceSuffix, requiredRange, update,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runChineseTabReflowScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 6 });
  try {
    const raw = "中文\t结果";
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", raw, "mutable")]);
    await fixture.endpoint.drain();
    fixture.terminal.select(0, requiredRange(fixture, "text").start, 12);
    assertEqual(fixture.terminal.getSelection(), "中文    结果", "Chinese occupies two cells before the Tab stop");
    assertEqual(copySelection(fixture.terminal), raw, "initial Chinese and Tab copy");
    for (const cols of [5, 9, 20]) {
      fixture.endpoint.resize(cols, 6);
      assertEqual(copySelection(fixture.terminal), raw, "Chinese/Tab copy after resize to " + cols);
      assertBlockContent(fixture, "text", raw);
    }
    return { name: "Chinese and Tab Copy Through Reflow",
      detail: "20-to-5-to-9-to-20-column reflow kept the Chinese text and HT without copying wide-wrap padding" };
  } finally { fixture.dispose(); }
}

export async function runChinesePartialSelectionScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 6 });
  try {
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", "A中文B\t尾", "mutable")]);
    await fixture.endpoint.drain();
    const row = requiredRange(fixture, "text").start;
    // Both endpoints are inside a two-cell glyph, not on its boundaries.
    fixture.terminal.select(2, row, 2);
    assertEqual(fixture.terminal.getSelectionPosition()?.start.x, 1, "start expanded to the beginning of 中");
    assertEqual(fixture.terminal.getSelectionPosition()?.end.x, 5, "end expanded past 文");
    assertEqual(copySelection(fixture.terminal), "中文", "half-glyph endpoints copy both complete characters");
    fixture.endpoint.resize(3, 6);
    assertEqual(copySelection(fixture.terminal), "中文", "normalized selection survives wide-glyph reflow");
    fixture.endpoint.resize(20, 6);
    fixture.terminal.select(7, requiredRange(fixture, "text").start, 1);
    assertEqual(copySelection(fixture.terminal), " ", "part of the adjacent Tab still copies only one space");
    return { name: "Half-Chinese Selection Includes Complete Characters",
      detail: "both interior endpoints expanded to whole ideographs; a partial Tab stayed one selected space" };
  } finally { fixture.dispose(); }
}

export async function runChineseRetainedSelectionScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 6 });
  try {
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", "中文\t结果", "mutable")]);
    await fixture.endpoint.drain();
    fixture.terminal.select(0, requiredRange(fixture, "text").start, 8);
    fixture.endpoint.resize(9, 6);
    assertEqual(copySelection(fixture.terminal), "中文\t", "prefix ends before padding for the wrapped 结");
    pushMessages(fixture.endpoint, [extend(fixture.contextId, "2", "text", "1", "好")]);
    await fixture.endpoint.drain();
    assertEqual(copySelection(fixture.terminal), "中文\t", "Extend does not add its fragment to the old selection");
    pushMessages(fixture.endpoint, [replaceSuffix(fixture.contextId, "3", "text", "2", 3, "新内容")]);
    await fixture.endpoint.drain();
    assertBlockContent(fixture, "text", "中文\t新内容");
    assertEqual(copySelection(fixture.terminal), "中文\t", "three raw scalars retain the eight-cell prefix");
    fixture.terminal.select(0, requiredRange(fixture, "text").start + 1, 1);
    assertEqual(copySelection(fixture.terminal), "新", "selecting half of the replacement includes the whole new glyph");
    pushMessages(fixture.endpoint, [replaceSuffix(fixture.contextId, "4", "text", "3", 3, "改")]);
    await fixture.endpoint.drain();
    assertEqual(copySelection(fixture.terminal), undefined, "removing the selected glyph clears the copy source");
    pushMessages(fixture.endpoint, [update(fixture.contextId, "5", "text", "中\t文")]);
    await fixture.endpoint.drain();
    assertBlockContent(fixture, "text", "中\t文");
    fixture.terminal.select(0, requiredRange(fixture, "text").start, 11);
    assertEqual(copySelection(fixture.terminal), "中\t文", "full Update renders the new Chinese/Tab snapshot at the resized width");
    return { name: "Chinese Prefix Survives Incremental Operations After Resize",
      detail: "raw-scalar ReplaceSuffix preserved the selected prefix, removed-glyph selection cleared, and Update remained correctly positioned" };
  } finally { fixture.dispose(); }
}
