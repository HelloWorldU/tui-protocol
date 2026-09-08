import {
  append, assertBlockContent, assertBufferRows, assertEqual, assertTrue,
  copySelection, createFixture, pushMessages, requiredRange, selectAcrossRows,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export function runChineseAppendRetainsSelectionScenario(): Promise<ScenarioResult> {
  return runChineseAppendCapacity(false);
}

export function runChineseAppendEvictsSelectionScenario(): Promise<ScenarioResult> {
  return runChineseAppendCapacity(true);
}

export function runChineseAppendRetainsSearchScenario(): Promise<ScenarioResult> {
  return runChineseAppendCapacity(false, true);
}

export function runChineseAppendEvictsSearchScenario(): Promise<ScenarioResult> {
  return runChineseAppendCapacity(true, true);
}

async function runChineseAppendCapacity(selectOldest: boolean, search = false): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 8, rows: 3, scrollback: 6 });
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "oldest", "\t旧", "sealed"),
      append(fixture.contextId, "2", "reader", "中\t文", "sealed"),
      append(fixture.contextId, "3", "tail", "t1\nt2\nt3", "sealed"),
    ]);
    await fixture.endpoint.drain();
    assertBufferRows(fixture.terminal, ["        ", "旧", "中      ", "文", "t1", "t2", "t3", ""]);
    const selected = requiredRange(fixture, selectOldest ? "oldest" : "reader");
    fixture.terminal.scrollToLine(selected.start);
    if (search) {
      assertEqual(fixture.endpoint.findNext(selectOldest ? "旧" : "文"), true, "current match before Append");
      fixture.terminal.scrollToLine(selected.start);
    } else {
      selectAcrossRows(fixture.terminal, 0, selected.start, 2, selected.start + 1);
    }
    const expectedCopy = search ? (selectOldest ? "旧" : "文") : (selectOldest ? "\t旧" : "中\t文");
    assertEqual(copySelection(fixture.terminal), expectedCopy, "copy before tail Append");
    // Three new rows exceed capacity by exactly the two-row oldest Block.
    pushMessages(fixture.endpoint, [append(fixture.contextId, "4", "new", "新\t文\t尾", "sealed")]);
    await fixture.endpoint.drain();
    assertEqual(fixture.endpoint.range(fixture.contextId, "oldest"), undefined, "Append evicts complete oldest Block");
    assertEqual(requiredRange(fixture, "reader").start, 0, "retained reader moves to row zero");
    assertEqual(requiredRange(fixture, "new").lineCount, 3, "new Chinese/Tab Block occupies three rows");
    assertBufferRows(fixture.terminal, ["中      ", "文", "t1", "t2", "t3", "新      ", "文      ", "尾", ""]);
    assertEqual(fixture.terminal.buffer.active.viewportY, 0, "reading stays at the retained reader instead of tail");
    assertTrue(fixture.terminal.buffer.active.viewportY < fixture.terminal.buffer.active.baseY, "history reading remains active");
    if (selectOldest) {
      assertEqual(fixture.terminal.hasSelection(), false, "evicted selection clears");
      assertEqual(copySelection(fixture.terminal), undefined, "evicted Tab is no longer copied");
    } else {
      assertEqual(copySelection(fixture.terminal), expectedCopy, "retained copy survives Append eviction");
      assertEqual(fixture.terminal.getSelectionPosition()?.start.y, search ? 1 : 0, "retained selection starts in its intended row");
      assertEqual(fixture.terminal.getSelectionPosition()?.end.y, 1, "retained selection includes its second row");
    }
    assertBlockContent(fixture, "oldest", "\t旧");
    assertBlockContent(fixture, "reader", "中\t文");
    assertBlockContent(fixture, "new", "新\t文\t尾");
    fixture.terminal.clearSelection();
    assertEqual(fixture.endpoint.findNext("旧"), false, "Append-evicted text leaves search");
    assertEqual(fixture.endpoint.findNext("尾"), true, "newly appended Chinese text enters search");
    assertEqual(copySelection(fixture.terminal), "尾", "new tail search match copies its complete character");
    assertEqual(fixture.terminal.getSelectionPosition()?.start.y, 7, "new match belongs to appended tail row");
    if (search) {
      return { name: selectOldest ? "Chinese Append Eviction Clears the Current Search Match" : "Chinese Append Eviction Preserves a Retained Search Match",
        detail: selectOldest ? "the removed match lost its copy source and new tail text became searchable" : "the same match stayed selected at its new row and new tail text became searchable" };
    }
    return { name: selectOldest ? "Chinese Append Eviction Clears the Oldest Selection" : "Chinese Append Eviction Preserves a Retained Selection",
      detail: selectOldest ? "the old copy source cleared and reading moved to the next Block" : "the reader and Chinese/Tab copy stayed attached while a new tail appeared once" };
  } finally { fixture.dispose(); }
}
