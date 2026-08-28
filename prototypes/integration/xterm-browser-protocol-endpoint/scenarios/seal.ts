import {
  append,
  assertBlockContent,
  assertBlockLifecycle,
  assertEqual,
  copySelection,
  createFixture,
  decodeResponses,
  encodeInput,
  pushMessages,
  requiredRange,
  seal,
  update,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runSealSelectionAndRejectionScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "thinking",
        "stay-selected",
        "mutable",
      ),
      append(
        fixture.contextId,
        "2",
        "tail",
        "tail-1\ntail-2\ntail-3\ntail-4",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    const thinkingBefore = requiredRange(fixture, "thinking");
    fixture.terminal.scrollToLine(thinkingBefore.start);
    fixture.terminal.select(
      0,
      thinkingBefore.start,
      "stay-selected".length,
    );

    pushMessages(fixture.endpoint, [
      seal(fixture.contextId, "3", "thinking"),
    ]);
    await fixture.endpoint.drain();

    const thinkingAfterSeal = requiredRange(fixture, "thinking");
    assertEqual(
      thinkingAfterSeal.start,
      thinkingBefore.start,
      "sealed Block start row",
    );
    assertEqual(
      thinkingAfterSeal.lineCount,
      thinkingBefore.lineCount,
      "sealed Block rendered row count",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      thinkingBefore.start,
      "reading row after Seal",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "stay-selected",
      "selection after Seal",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "stay-selected",
      "copy after Seal",
    );
    assertBlockLifecycle(fixture, "thinking", "sealed");
    assertBlockContent(fixture, "thinking", "stay-selected");

    const rejected = fixture.endpoint.push(
      encodeInput(
        update(fixture.contextId, "4", "thinking", "too late"),
        4,
      ),
    );
    assertEqual(rejected.diagnostics.length, 0, "sealed-Block Update diagnostics");
    const responses = decodeResponses(rejected);
    assertEqual(responses.length, 1, "sealed-Block Update response count");
    const [error] = responses;
    assertEqual(error?.kind, "protocol.error", "sealed-Block Update response kind");
    if (error?.kind !== "protocol.error") {
      throw new Error("Expected a protocol.error for an Update after Seal.");
    }
    assertEqual(error.operation_id, "4", "sealed-Block Update operation ID");
    assertEqual(error.context_id, fixture.contextId, "sealed-Block Update Context ID");
    assertEqual(error.body.code, "block_sealed", "sealed-Block Update error code");
    await fixture.endpoint.drain();

    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      thinkingBefore.start,
      "reading row after rejected sealed-Block Update",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "stay-selected",
      "selection after rejected sealed-Block Update",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "stay-selected",
      "copy after rejected sealed-Block Update",
    );
    assertBlockLifecycle(fixture, "thinking", "sealed");
    assertBlockContent(fixture, "thinking", "stay-selected");
    return {
      name: "OSC Seal Preserves Selection and Rejects a Later Update",
      detail: "the Block became sealed without changing its viewport row or copy source, then returned block_sealed",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runSealSearchScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(
        fixture.contextId,
        "1",
        "thinking",
        "persistent match",
        "mutable",
      ),
    ]);
    await fixture.endpoint.drain();
    assertEqual(
      fixture.endpoint.findNext("persistent"),
      true,
      "current search before Seal",
    );

    pushMessages(fixture.endpoint, [
      seal(fixture.contextId, "2", "thinking"),
    ]);
    await fixture.endpoint.drain();

    assertEqual(
      fixture.terminal.getSelection(),
      "persistent",
      "current search match after Seal",
    );
    assertEqual(
      fixture.endpoint.findNext("persistent"),
      true,
      "searchable content after Seal",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "persistent",
      "repeated current match after Seal",
    );
    assertBlockLifecycle(fixture, "thinking", "sealed");
    assertBlockContent(fixture, "thinking", "persistent match");
    return {
      name: "OSC Seal Preserves Searchable Content",
      detail: "the current match and searchable text stayed unchanged as the Block became sealed",
    };
  } finally {
    fixture.dispose();
  }
}
