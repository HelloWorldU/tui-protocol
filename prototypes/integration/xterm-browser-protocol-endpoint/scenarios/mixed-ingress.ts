import type { Terminal } from "@xterm/xterm";

import {
  append,
  assertBlockContent,
  assertEqual,
  concatenate,
  copySelection,
  createMixedFixture,
  encodeInput,
  requiredRange,
  text,
  update,
} from "../scenario-harness.ts";
import type {
  MixedFixture,
  ScenarioResult,
} from "../scenario-harness.ts";

export async function runEarlierUpdatePreservesMixedSelectionScenario(): Promise<ScenarioResult> {
  const fixture = await createMixedFixture({ cols: 20, rows: 4 });
  try {
    await fixture.ingress.push(
      concatenate([
        encodeInput(
          append(fixture.contextId, "1", "earlier", "old", "mutable"),
          3,
        ),
        encodeInput(
          append(fixture.contextId, "2", "managed", "managed", "sealed"),
          4,
        ),
        text("ordinary\r\n"),
        encodeInput(
          append(
            fixture.contextId,
            "3",
            "tail",
            "tail-1\ntail-2\ntail-3\ntail-4",
            "sealed",
          ),
          5,
        ),
      ]),
    );
    assertNoMixedErrors(fixture, "initial mixed stream");

    const managedBefore = requiredRange(fixture, "managed");
    const ordinaryBefore = managedBefore.start + managedBefore.lineCount;
    selectAcrossRows(
      fixture.terminal,
      0,
      managedBefore.start,
      "ordi".length,
      ordinaryBefore,
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "managed\nordi",
      "mixed selection before earlier Update",
    );

    await fixture.ingress.push(
      encodeInput(
        update(
          fixture.contextId,
          "4",
          "earlier",
          "new-1\nnew-2\nnew-3",
        ),
        6,
      ),
    );
    assertNoMixedErrors(fixture, "earlier Block growth");

    const managedAfterGrowth = requiredRange(fixture, "managed");
    assertEqual(
      managedAfterGrowth.start,
      managedBefore.start + 2,
      "managed Block row after earlier growth",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      managedAfterGrowth.start,
      "mixed selection row after earlier growth",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.end.y,
      managedAfterGrowth.start + 1,
      "mixed selection end row after earlier growth",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.end.x,
      "ordi".length,
      "mixed selection end column after earlier growth",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "managed\nordi",
      "mixed selection after earlier growth",
    );
    assertBufferRows(fixture.terminal, [
      "new-1",
      "new-2",
      "new-3",
      "managed",
      "ordinary",
      "tail-1",
      "tail-2",
      "tail-3",
      "tail-4",
      "",
    ]);

    await fixture.ingress.push(
      encodeInput(
        update(fixture.contextId, "5", "earlier", "final"),
        7,
      ),
    );
    assertNoMixedErrors(fixture, "earlier Block shrink");

    const managedAfterShrink = requiredRange(fixture, "managed");
    assertEqual(
      managedAfterShrink.start,
      managedBefore.start,
      "managed Block row after earlier shrink",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      managedAfterShrink.start,
      "mixed selection row after earlier shrink",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.end.y,
      managedAfterShrink.start + 1,
      "mixed selection end row after earlier shrink",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.end.x,
      "ordi".length,
      "mixed selection end column after earlier shrink",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "managed\nordi",
      "mixed selection after earlier shrink",
    );
    assertBufferRows(fixture.terminal, [
      "final",
      "managed",
      "ordinary",
      "tail-1",
      "tail-2",
      "tail-3",
      "tail-4",
      "",
    ]);
    assertBlockContent(fixture, "earlier", "final");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after preserving the mixed selection",
    );
    return {
      name: "Earlier Update Preserves Managed-to-Unmanaged Selection",
      detail:
        "the cross-boundary selection moved with its text and kept one copied newline",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runSelectedUpdateClearsMixedSelectionScenario(): Promise<ScenarioResult> {
  const fixture = await createMixedFixture({ cols: 20, rows: 4 });
  try {
    await fixture.ingress.push(
      concatenate([
        text("ordinary\r\n"),
        encodeInput(
          append(
            fixture.contextId,
            "1",
            "managed",
            "managed",
            "mutable",
          ),
          3,
        ),
        encodeInput(
          append(fixture.contextId, "2", "tail", "tail", "sealed"),
          4,
        ),
      ]),
    );
    assertNoMixedErrors(fixture, "initial reverse-boundary stream");

    const managed = requiredRange(fixture, "managed");
    selectAcrossRows(
      fixture.terminal,
      "ord".length,
      managed.start - 1,
      "mana".length,
      managed.start,
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "inary\nmana",
      "mixed selection before selected Block Update",
    );

    await fixture.ingress.push(
      encodeInput(
        update(fixture.contextId, "3", "managed", "replacement"),
        5,
      ),
    );
    assertNoMixedErrors(fixture, "selected Block Update");

    assertEqual(
      fixture.terminal.hasSelection(),
      false,
      "selection after updating its managed Block",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "",
      "selection text after updating its managed Block",
    );
    assertEqual(
      copySelection(fixture.terminal),
      undefined,
      "copy event after updating its managed Block",
    );
    assertBufferRows(fixture.terminal, [
      "ordinary",
      "replacement",
      "tail",
      "",
    ]);
    assertBlockContent(fixture, "managed", "replacement");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after clearing the mixed selection",
    );
    return {
      name: "Selected Update Clears Unmanaged-to-Managed Selection",
      detail:
        "replacing the selected Block cleared the whole cross-boundary copy source",
    };
  } finally {
    fixture.dispose();
  }
}

function selectAcrossRows(
  terminal: Terminal,
  startColumn: number,
  startRow: number,
  endColumn: number,
  endRow: number,
): void {
  terminal.select(
    startColumn,
    startRow,
    (endRow - startRow) * terminal.cols + endColumn - startColumn,
  );
}

function assertSelectionAndCopy(
  terminal: Terminal,
  expected: string,
  label: string,
): void {
  assertEqual(
    normalizeNewlines(terminal.getSelection()),
    expected,
    `${label} text`,
  );
  assertEqual(
    normalizeNewlines(copySelection(terminal)),
    expected,
    `${label} copy event`,
  );
}

function assertNoMixedErrors(fixture: MixedFixture, label: string): void {
  const result = fixture.takeResult();
  assertEqual(result.diagnostics.length, 0, `${label} diagnostics`);
  assertEqual(result.responseFrames.length, 0, `${label} response frames`);
}

function assertBufferRows(terminal: Terminal, expected: readonly string[]): void {
  const buffer = terminal.buffer.normal;
  const actual: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    actual.push(buffer.getLine(index)?.translateToString(true) ?? "");
  }
  assertEqual(
    JSON.stringify(actual),
    JSON.stringify(expected),
    "normal Buffer rows",
  );
}

function normalizeNewlines(value: string | undefined): string | undefined {
  return value?.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
