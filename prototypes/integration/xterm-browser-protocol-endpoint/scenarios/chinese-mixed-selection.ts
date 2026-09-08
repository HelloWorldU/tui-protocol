import {
  append, assertBlockContent, assertEqual, assertNoMixedErrors, concatenate,
  copySelection, createMixedFixture, encodeInput, extend, replaceSuffix,
  requiredRange, seal, selectAcrossRows, text, update,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runChineseMixedSelectionScenario(): Promise<ScenarioResult> {
  const fixture = await createMixedFixture({ cols: 20, rows: 4 });
  try {
    await fixture.ingress.push(concatenate([
      encodeInput(append(fixture.contextId, "1", "managed", "中文\t结果", "mutable"), 3),
      text("raw-abcdef\r\n"),
      encodeInput(append(fixture.contextId, "2", "later", "后文", "mutable"), 4),
    ]));
    assertNoMixedErrors(fixture, "Chinese Block and ordinary ASCII ingress");
    const ordinaryRow = (): number => {
      const range = requiredRange(fixture, "managed");
      return range.start + range.lineCount;
    };
    selectAcrossRows(fixture.terminal, 2, requiredRange(fixture, "managed").start, 3, ordinaryRow());
    assertEqual(copySelection(fixture.terminal), "文\t结果\nraw", "mixed copy preserves managed Tab and one boundary newline");
    for (const cols of [9, 20]) {
      fixture.resize(cols, 4);
      assertEqual(copySelection(fixture.terminal), "文\t结果\nraw", "mixed Chinese selection survives resize to " + cols);
      assertEqual(fixture.terminal.getSelectionPosition()?.end.y, ordinaryRow(), "selection end follows ordinary row");
    }
    await fixture.ingress.push(encodeInput(extend(fixture.contextId, "3", "managed", "1", "追加"), 5));
    assertNoMixedErrors(fixture, "mixed Chinese Extend");
    assertEqual(copySelection(fixture.terminal), "文\t结果追加\nraw", "Extend inside mixed selection adds its Chinese fragment");
    await fixture.ingress.push(encodeInput(replaceSuffix(fixture.contextId, "4", "managed", "3", 3, "新"), 6));
    assertNoMixedErrors(fixture, "mixed Chinese suffix replacement");
    assertEqual(copySelection(fixture.terminal), undefined, "replacing selected Chinese suffix clears whole mixed selection");
    assertBlockContent(fixture, "managed", "中文\t新");

    selectAcrossRows(fixture.terminal, 0, ordinaryRow(), 2, requiredRange(fixture, "later").start);
    assertEqual(copySelection(fixture.terminal), "raw-abcdef\n后", "reverse boundary copies one complete Chinese character");
    await fixture.ingress.push(encodeInput(update(fixture.contextId, "5", "later", "替换"), 7));
    assertNoMixedErrors(fixture, "selected Chinese Block Update");
    assertEqual(copySelection(fixture.terminal), undefined, "Update clears selection crossing from ordinary output");
    selectAcrossRows(fixture.terminal, 0, ordinaryRow(), 2, requiredRange(fixture, "later").start);
    await fixture.ingress.push(concatenate([
      encodeInput(seal(fixture.contextId, "6", "later"), 8),
      encodeInput(append(fixture.contextId, "7", "tail", "尾", "sealed"), 9),
    ]));
    assertNoMixedErrors(fixture, "Seal and Append beside Chinese mixed selection");
    assertEqual(copySelection(fixture.terminal), "raw-abcdef\n替", "Seal and later Append preserve existing reverse-boundary copy");
    assertBlockContent(fixture, "later", "替换");
    return { name: "Chinese Mixed Selection Follows Reflow and Content Changes",
      detail: "Chinese/Tab copy crossed ordinary ASCII with one newline; Extend added text, replacement cleared it, and Seal/Append preserved a new selection" };
  } finally { fixture.dispose(); }
}
