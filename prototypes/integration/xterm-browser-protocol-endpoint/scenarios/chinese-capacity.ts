import {
  append, assertBlockContent, assertBufferRows, assertEqual, copySelection,
  createFixture, pushMessages, requiredRange, update,
} from "../scenario-harness.ts";
import type { Fixture, ScenarioResult } from "../scenario-harness.ts";

export async function runChineseCapacityRetainsSearchScenario(): Promise<ScenarioResult> {
  const fixture = await createChineseCapacityFixture();
  try {
    assertEqual(fixture.endpoint.findNext("文"), true, "reader match before eviction");
    const before = requiredRange(fixture, "reader");
    assertReaderMatch(fixture, before.start + 1);
    fixture.terminal.scrollToBottom();

    await growChineseCapacityFixture(fixture);

    const after = requiredRange(fixture, "reader");
    assertEqual(after.start, before.start + 1, "reader moved by three added rows minus two evicted rows");
    assertReaderMatch(fixture, after.start + 1);
    assertEqual(fixture.endpoint.findNext("旧"), false, "evicted Chinese text is absent from search");
    assertEqual(fixture.endpoint.findNext("文"), true, "retained Chinese text remains searchable");
    assertReaderMatch(fixture, after.start + 1);
    return {
      name: "Chinese Capacity Eviction Preserves a Retained Search Match",
      detail: "the wide match and copied character moved with the retained Block while evicted text left search",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runChineseCapacityEvictsSearchScenario(): Promise<ScenarioResult> {
  const fixture = await createChineseCapacityFixture();
  try {
    assertEqual(fixture.endpoint.findNext("旧"), true, "oldest Chinese match before eviction");
    assertEqual(copySelection(fixture.terminal), "旧", "oldest match copy before eviction");
    assertEqual(fixture.terminal.getSelectionPosition()?.start.y, 1, "oldest match row before eviction");
    fixture.terminal.scrollToBottom();

    await growChineseCapacityFixture(fixture);

    assertEqual(fixture.terminal.hasSelection(), false, "evicted current match loses its selection");
    assertEqual(copySelection(fixture.terminal), undefined, "evicted Chinese match loses its copy source");
    assertEqual(fixture.endpoint.findNext("旧"), false, "evicted match cannot be found again");
    assertEqual(fixture.endpoint.findNext("文"), true, "retained Chinese content can become the next match");
    assertReaderMatch(fixture, requiredRange(fixture, "reader").start + 1);
    return {
      name: "Chinese Capacity Eviction Clears an Evicted Search Match",
      detail: "the removed Chinese match lost its copy source while retained Chinese text remained searchable",
    };
  } finally {
    fixture.dispose();
  }
}

function assertReaderMatch(fixture: Fixture, row: number): void {
  assertEqual(fixture.terminal.getSelection(), "文", "current match is the retained character");
  assertEqual(copySelection(fixture.terminal), "文", "copy contains the retained character");
  const position = fixture.terminal.getSelectionPosition();
  assertEqual(position?.start.x, 0, "wide match starts at column zero");
  assertEqual(position?.start.y, row, "wide match starts in the intended Block row");
  assertEqual(position?.end.x, 2, "wide match includes both cells");
  assertEqual(position?.end.y, row, "wide match ends in the same row");
}

async function createChineseCapacityFixture(): Promise<Fixture> {
  const fixture = createFixture({ cols: 8, rows: 3, scrollback: 6 });
  pushMessages(fixture.endpoint, [
    append(fixture.contextId, "1", "oldest", "\t旧", "sealed"),
    append(fixture.contextId, "2", "growing", "B", "mutable"),
    append(fixture.contextId, "3", "reader", "中\t文", "sealed"),
    append(fixture.contextId, "4", "tail", "t1\nt2", "sealed"),
  ]);
  await fixture.endpoint.drain();
  assertEqual(requiredRange(fixture, "oldest").lineCount, 2, "oldest Chinese and Tab Block occupies two rows");
  assertEqual(requiredRange(fixture, "reader").start, 3, "reader starts after the initial three rows");
  assertBufferRows(fixture.terminal, ["        ", "旧", "B", "中      ", "文", "t1", "t2", ""]);
  return fixture;
}

async function growChineseCapacityFixture(fixture: Fixture): Promise<void> {
  // The projected snapshot adds three rows, exceeding capacity by exactly
  // the two rows of the oldest Block. No partial-Block eviction is involved.
  pushMessages(fixture.endpoint, [update(fixture.contextId, "5", "growing", "\x1b\t新\tY")]);
  await fixture.endpoint.drain();
  assertEqual(fixture.endpoint.range(fixture.contextId, "oldest"), undefined, "oldest complete Block was evicted");
  assertEqual(requiredRange(fixture, "growing").lineCount, 4, "Chinese and Tab projection uses four rows");
  assertBufferRows(fixture.terminal, ["<U+001B>", "        ", "新      ", "Y", "中      ", "文", "t1", "t2", ""]);
  assertBlockContent(fixture, "oldest", "\t旧");
  assertBlockContent(fixture, "growing", "\x1b\t新\tY");
  assertBlockContent(fixture, "reader", "中\t文");
  assertEqual(fixture.endpoint.context(fixture.contextId)?.state, "open", "capacity eviction leaves the Context open");
}
