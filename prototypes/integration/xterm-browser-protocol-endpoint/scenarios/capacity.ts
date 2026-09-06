import {
  append,
  assertBlockContent,
  assertBufferRows,
  assertEqual,
  assertInputStateUnchanged,
  assertTrue,
  copySelection,
  createFixture,
  inputSnapshot,
  pushMessages,
  requiredRange,
  update,
  write,
} from "../scenario-harness.ts";
import type { Fixture, ScenarioResult } from "../scenario-harness.ts";

export async function runProjectedCapacityRetainsSelectionScenario(): Promise<ScenarioResult> {
  const fixture = await createProjectedCapacityFixture();
  try {
    const before = requiredRange(fixture, "reader");
    fixture.terminal.scrollToLine(before.start);
    fixture.terminal.select(0, before.start, 9);
    assertEqual(copySelection(fixture.terminal), "r\ts", "Tab copy before eviction");

    await growProjectedCapacityFixture(fixture);

    const after = requiredRange(fixture, "reader");
    assertEqual(after.start, before.start + 1, "reader moved by growth minus complete-Block trimming");
    assertEqual(fixture.terminal.buffer.active.viewportY, after.start, "the same reader row stays at viewport top");
    assertTrue(fixture.terminal.buffer.active.viewportY < fixture.terminal.buffer.active.baseY,
      "retained reading position did not switch to tail following");
    assertEqual(fixture.terminal.getSelectionPosition()?.start.y, after.start, "selection moved with its reader Block");
    assertEqual(copySelection(fixture.terminal), "r\ts", "retained copy restores the Tab at its new rows");
    assertBlockContent(fixture, "reader", "r\ts");
    return {
      name: "Projected Text Growth Evicts an Earlier Block and Preserves Tab Copy",
      detail: "the reader moved by one row while its viewport position and Tab-preserving copy stayed unchanged",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runProjectedCapacityEvictsSelectionScenario(): Promise<ScenarioResult> {
  const fixture = await createProjectedCapacityFixture();
  try {
    const oldest = requiredRange(fixture, "oldest");
    fixture.terminal.scrollToLine(oldest.start + 1);
    fixture.terminal.select(0, oldest.start, 9);
    assertEqual(copySelection(fixture.terminal), "\tO", "selected Tab and letter before eviction");

    await growProjectedCapacityFixture(fixture);

    assertEqual(fixture.terminal.hasSelection(), false, "the evicted projected Block loses its selection");
    assertEqual(copySelection(fixture.terminal), undefined, "the evicted Tab is not a stale copy source");
    assertEqual(fixture.terminal.buffer.active.viewportY, 0, "reading moves to the nearest retained Block");
    assertEqual(fixture.terminal.buffer.active.getLine(0)?.translateToString(true),
      "<U+001B>", "the next retained content is the visible ESC label");
    assertTrue(fixture.terminal.buffer.active.viewportY < fixture.terminal.buffer.active.baseY,
      "evicting the reading position did not switch to tail following");
    return {
      name: "Projected Text Growth Evicts a Selected Tab Block and Clears Copy",
      detail: "the old Tab lost its copy source and reading moved forward to the retained control label",
    };
  } finally {
    fixture.dispose();
  }
}

async function createProjectedCapacityFixture(): Promise<Fixture> {
  const fixture = createFixture({ cols: 8, rows: 3, scrollback: 6 });
  pushMessages(fixture.endpoint, [
    append(fixture.contextId, "1", "oldest", "\tO", "sealed"),
    append(fixture.contextId, "2", "growing", "B", "mutable"),
    append(fixture.contextId, "3", "reader", "r\ts", "sealed"),
    append(fixture.contextId, "4", "tail", "t1\nt2", "sealed"),
  ]);
  await fixture.endpoint.drain();
  assertEqual(requiredRange(fixture, "oldest").lineCount, 2, "two raw scalars occupy two rendered rows");
  assertEqual(requiredRange(fixture, "reader").start, 3, "reader start before growth");
  assertBufferRows(fixture.terminal, ["        ", "O", "B", "r       ", "s", "t1", "t2", ""]);
  return fixture;
}

async function growProjectedCapacityFixture(fixture: Fixture): Promise<void> {
  // Five raw scalars expand to 25 cells / four rows at eight columns.
  // Three added rows exceed capacity by exactly the oldest Block's two rows.
  pushMessages(fixture.endpoint, [
    update(fixture.contextId, "5", "growing", "\x1b\tX\tY"),
  ]);
  await fixture.endpoint.drain();
  assertEqual(fixture.endpoint.range(fixture.contextId, "oldest"), undefined, "complete oldest Block was evicted");
  assertEqual(requiredRange(fixture, "growing").lineCount, 4, "capacity used projected rows rather than raw scalars");
  assertBufferRows(fixture.terminal, ["<U+001B>", "        ", "X       ", "Y", "r       ", "s", "t1", "t2", ""]);
  assertBlockContent(fixture, "oldest", "\tO");
  assertBlockContent(fixture, "growing", "\x1b\tX\tY");
  assertEqual(fixture.endpoint.context(fixture.contextId)?.state, "open", "Context remains open after complete-Block eviction");
}

export async function runCapacityRetainsSelectionAndReadingScenario(): Promise<ScenarioResult> {
  const fixture = await createCapacityFixture();
  try {
    const readerBefore = requiredRange(fixture, "capacity-reader");
    fixture.terminal.scrollToLine(readerBefore.start);
    fixture.terminal.select(0, readerBefore.start, "reader".length);

    await growCapacityFixture(fixture);

    const readerAfter = requiredRange(fixture, "capacity-reader");
    assertEqual(
      fixture.endpoint.range(fixture.contextId, "capacity-oldest"),
      undefined,
      "oldest Block rendered range after capacity eviction",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      readerAfter.start,
      "retained reading row after capacity eviction",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "reader",
      "retained selection after capacity eviction",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      readerAfter.start,
      "retained selection row after capacity eviction",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "reader",
      "retained copy after capacity eviction",
    );
    assertBlockContent(fixture, "capacity-oldest", "old-11111old-22222");
    assertBlockContent(
      fixture,
      "capacity-growing",
      "new-11111new-22222new-33333new-4",
    );
    return {
      name: "Capacity Eviction Preserves a Retained Reading Position and Selection",
      detail: "the oldest rendered Block disappeared while the later reader row and copy source stayed attached",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runCapacityEvictsSelectedBlockScenario(): Promise<ScenarioResult> {
  const fixture = await createCapacityFixture();
  try {
    const oldest = requiredRange(fixture, "capacity-oldest");
    fixture.terminal.scrollToLine(oldest.start);
    fixture.terminal.select(0, oldest.start, "old-11111".length);

    await growCapacityFixture(fixture);

    const nextRetained = requiredRange(fixture, "capacity-growing");
    assertEqual(
      fixture.endpoint.range(fixture.contextId, "capacity-oldest"),
      undefined,
      "selected Block rendered range after capacity eviction",
    );
    assertEqual(
      fixture.terminal.hasSelection(),
      false,
      "selection after its complete Block is evicted",
    );
    assertEqual(
      copySelection(fixture.terminal),
      undefined,
      "copy after its complete Block is evicted",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      nextRetained.start,
      "reading row after its complete Block is evicted",
    );
    assertTrue(
      fixture.terminal.buffer.active.viewportY <
        fixture.terminal.buffer.active.baseY,
      "evicted reading position did not switch to tail following",
    );
    assertBlockContent(fixture, "capacity-oldest", "old-11111old-22222");
    return {
      name: "Capacity Eviction Clears an Evicted Selection and Moves Reading Forward",
      detail: "the removed Block lost its copy source and the viewport moved to the next retained Block without following the tail",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runCapacityRetainsSearchMatchScenario(): Promise<ScenarioResult> {
  const fixture = await createCapacityFixture();
  try {
    assertEqual(
      fixture.endpoint.findNext("reader"),
      true,
      "retained search before capacity eviction",
    );
    fixture.terminal.scrollToBottom();

    await growCapacityFixture(fixture);

    const readerAfter = requiredRange(fixture, "capacity-reader");
    assertEqual(
      fixture.endpoint.range(fixture.contextId, "capacity-oldest"),
      undefined,
      "oldest search Block range after capacity eviction",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "reader",
      "retained current match after capacity eviction",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      readerAfter.start,
      "retained current match row after capacity eviction",
    );
    assertEqual(
      fixture.endpoint.findNext("old-11111"),
      false,
      "evicted text search after capacity eviction",
    );
    assertEqual(
      fixture.endpoint.findNext("reader"),
      true,
      "retained text search after capacity eviction",
    );
    return {
      name: "Capacity Eviction Preserves a Retained Search Match",
      detail: "the later match stayed attached while evicted rendered text left the search projection",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runCapacityEvictsSearchMatchScenario(): Promise<ScenarioResult> {
  const fixture = await createCapacityFixture();
  try {
    assertEqual(
      fixture.endpoint.findNext("old-11111"),
      true,
      "evicted search before capacity eviction",
    );
    fixture.terminal.scrollToBottom();

    await growCapacityFixture(fixture);

    assertEqual(
      fixture.endpoint.range(fixture.contextId, "capacity-oldest"),
      undefined,
      "current-match Block range after capacity eviction",
    );
    assertEqual(
      fixture.terminal.hasSelection(),
      false,
      "current search match after its complete Block is evicted",
    );
    assertEqual(
      fixture.endpoint.findNext("old-11111"),
      false,
      "evicted current-match search after capacity eviction",
    );
    assertEqual(
      fixture.endpoint.findNext("reader"),
      true,
      "retained search after current-match eviction",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "reader",
      "replacement current match after capacity eviction",
    );
    return {
      name: "Capacity Eviction Clears an Evicted Search Match",
      detail: "the removed match cleared and retained rendered text remained searchable",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runCapacityActiveInputScenario(): Promise<ScenarioResult> {
  const fixture = await createCapacityFixture();
  try {
    await write(fixture.terminal, "> edit");
    await write(fixture.terminal, "\u001b[2D");
    fixture.terminal.focus();
    const inputBefore = inputSnapshot(fixture.terminal);
    requiredRange(fixture, "capacity-oldest");

    await growCapacityFixture(fixture);

    const inputAfter = inputSnapshot(fixture.terminal);
    assertEqual(
      fixture.endpoint.range(fixture.contextId, "capacity-oldest"),
      undefined,
      "oldest Block rendered range after input-state capacity eviction",
    );
    assertInputStateUnchanged(
      inputAfter,
      inputBefore,
      "active input after capacity eviction",
    );
    assertBlockContent(
      fixture,
      "capacity-growing",
      "new-11111new-22222new-33333new-4",
    );
    return {
      name: "Capacity Eviction Preserves Active Input",
      detail: "removing an old complete Block changed no input text, cursor, or focus",
    };
  } finally {
    fixture.dispose();
  }
}

async function createCapacityFixture(): Promise<Fixture> {
  const fixture = createFixture({ cols: 10, rows: 3, scrollback: 7 });
  pushMessages(fixture.endpoint, [
    append(
      fixture.contextId,
      "1",
      "capacity-oldest",
      "old-11111old-22222",
      "sealed",
    ),
    append(
      fixture.contextId,
      "2",
      "capacity-growing",
      "draft",
      "mutable",
    ),
    append(
      fixture.contextId,
      "3",
      "capacity-reader",
      "reader",
      "sealed",
    ),
    append(
      fixture.contextId,
      "4",
      "capacity-tail",
      "tail-1111tail-2222tail-3333tail-4",
      "sealed",
    ),
  ]);
  await fixture.endpoint.drain();
  return fixture;
}

async function growCapacityFixture(fixture: Fixture): Promise<void> {
  pushMessages(fixture.endpoint, [
    update(
      fixture.contextId,
      "5",
      "capacity-growing",
      "new-11111new-22222new-33333new-4",
    ),
  ]);
  await fixture.endpoint.drain();
}
