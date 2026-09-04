import {
  append,
  assertBlockContent,
  assertBlockLifecycle,
  assertBufferRows,
  assertEqual,
  assertNoMixedErrors,
  assertSelectionAndCopy,
  assertSelectionPosition,
  concatenate,
  copySelection,
  createMixedFixture,
  encodeInput,
  extend,
  replaceSuffix,
  requiredRange,
  seal,
  selectAcrossRows,
  text,
  update,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

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

export async function runExtendIncludesFragmentInMixedSelectionScenario(): Promise<ScenarioResult> {
  const fixture = await createMixedFixture({ cols: 20, rows: 4 });
  try {
    await fixture.ingress.push(
      concatenate([
        encodeInput(
          append(fixture.contextId, "1", "managed", "managed", "mutable"),
          3,
        ),
        text("ordinary\r\n"),
        encodeInput(
          append(fixture.contextId, "2", "tail", "tail", "sealed"),
          4,
        ),
      ]),
    );
    assertNoMixedErrors(fixture, "initial Extend boundary stream");

    const managedBefore = requiredRange(fixture, "managed");
    const ordinaryBefore = managedBefore.start + managedBefore.lineCount;
    assertEqual(managedBefore.lineCount, 1, "managed rows before Extend");
    selectAcrossRows(
      fixture.terminal,
      3,
      managedBefore.start,
      "ordi".length,
      ordinaryBefore,
    );
    assertSelectionPosition(
      fixture.terminal,
      3,
      managedBefore.start,
      "ordi".length,
      ordinaryBefore,
      "mixed selection before Extend",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "aged\nordi",
      "mixed selection before Extend",
    );

    const fragment = "-0123456789abcdef";
    await fixture.ingress.push(
      encodeInput(
        extend(fixture.contextId, "3", "managed", "1", fragment),
        5,
      ),
    );
    assertNoMixedErrors(fixture, "cross-boundary Extend");

    const managedAfter = requiredRange(fixture, "managed");
    const ordinaryAfter = managedAfter.start + managedAfter.lineCount;
    assertEqual(
      managedAfter.start,
      managedBefore.start,
      "managed start after Extend",
    );
    assertEqual(managedAfter.lineCount, 2, "managed rows after Extend");
    assertEqual(
      ordinaryAfter,
      ordinaryBefore + 1,
      "unmanaged row after Extend",
    );
    assertSelectionPosition(
      fixture.terminal,
      3,
      managedAfter.start,
      "ordi".length,
      ordinaryAfter,
      "mixed selection after Extend",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      `aged${fragment}\nordi`,
      "mixed selection after Extend",
    );
    assertBufferRows(fixture.terminal, [
      "managed-0123456789ab",
      "cdef",
      "ordinary",
      "tail",
      "",
    ]);
    assertBlockContent(fixture, "managed", `managed${fragment}`);
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after extending the mixed selection",
    );
    return {
      name: "Extend Adds Its Fragment to a Managed-to-Unmanaged Selection",
      detail:
        "both endpoints stayed attached while the appended fragment entered the copy result",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runExtendExcludesFragmentAfterMixedSelectionScenario(): Promise<ScenarioResult> {
  const fixture = await createMixedFixture({ cols: 20, rows: 4 });
  try {
    await fixture.ingress.push(
      concatenate([
        text("ordinary\r\n"),
        encodeInput(
          append(fixture.contextId, "1", "managed", "managed", "mutable"),
          3,
        ),
        encodeInput(
          append(fixture.contextId, "2", "tail", "tail", "sealed"),
          4,
        ),
      ]),
    );
    assertNoMixedErrors(fixture, "initial reverse Extend boundary stream");

    const managedBefore = requiredRange(fixture, "managed");
    selectAcrossRows(fixture.terminal, 3, 0, 4, managedBefore.start);
    assertSelectionPosition(
      fixture.terminal,
      3,
      0,
      4,
      managedBefore.start,
      "mixed selection before trailing Extend",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "inary\nmana",
      "mixed selection before trailing Extend",
    );

    await fixture.ingress.push(
      encodeInput(
        extend(fixture.contextId, "3", "managed", "1", "-new"),
        5,
      ),
    );
    assertNoMixedErrors(fixture, "Extend after the selection endpoint");

    const managedAfter = requiredRange(fixture, "managed");
    assertSelectionPosition(
      fixture.terminal,
      3,
      0,
      4,
      managedAfter.start,
      "mixed selection after trailing Extend",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "inary\nmana",
      "mixed selection after trailing Extend",
    );
    assertBufferRows(fixture.terminal, [
      "ordinary",
      "managed-new",
      "tail",
      "",
    ]);
    assertBlockContent(fixture, "managed", "managed-new");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after extending beyond the mixed selection",
    );
    return {
      name:
        "Extend Preserves an Unmanaged-to-Managed Selection Ending Before the Appended Fragment",
      detail:
        "both endpoints and copied text stayed unchanged while the new fragment remained outside the selection",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runAppendAndSealPreserveMixedSelectionScenario(): Promise<ScenarioResult> {
  const fixture = await createMixedFixture({ cols: 20, rows: 4 });
  try {
    await fixture.ingress.push(
      concatenate([
        encodeInput(
          append(fixture.contextId, "1", "managed", "managed", "mutable"),
          3,
        ),
        text("ordinary\r\n"),
        encodeInput(
          append(fixture.contextId, "2", "tail", "tail", "sealed"),
          4,
        ),
      ]),
    );
    assertNoMixedErrors(fixture, "initial Append and Seal boundary stream");

    const managed = requiredRange(fixture, "managed");
    const ordinaryRow = managed.start + managed.lineCount;
    selectAcrossRows(fixture.terminal, 3, managed.start, 4, ordinaryRow);
    assertSelectionPosition(
      fixture.terminal,
      3,
      managed.start,
      4,
      ordinaryRow,
      "mixed selection before Seal",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "aged\nordi",
      "mixed selection before Seal",
    );

    await fixture.ingress.push(
      encodeInput(seal(fixture.contextId, "3", "managed"), 5),
    );
    assertNoMixedErrors(fixture, "selected Block Seal");
    assertBlockLifecycle(fixture, "managed", "sealed");
    assertSelectionPosition(
      fixture.terminal,
      3,
      managed.start,
      4,
      ordinaryRow,
      "mixed selection after Seal",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "aged\nordi",
      "mixed selection after Seal",
    );

    await fixture.ingress.push(
      encodeInput(
        append(fixture.contextId, "4", "later", "later", "sealed"),
        6,
      ),
    );
    assertNoMixedErrors(fixture, "tail Append after the mixed selection");
    assertSelectionPosition(
      fixture.terminal,
      3,
      managed.start,
      4,
      ordinaryRow,
      "mixed selection after tail Append",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "aged\nordi",
      "mixed selection after tail Append",
    );
    assertBufferRows(fixture.terminal, [
      "managed",
      "ordinary",
      "tail",
      "later",
      "",
    ]);
    assertEqual(
      requiredRange(fixture, "later").start,
      3,
      "later Block start after Append",
    );
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after preserving the selection through Seal and Append",
    );
    return {
      name: "Seal and Tail Append Preserve a Managed-to-Unmanaged Selection",
      detail:
        "neither Operation changed the selection endpoints or copied text",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runReplaceSuffixPreservesMixedPrefixSelectionScenario(): Promise<ScenarioResult> {
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
            "prefix-old",
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
    assertNoMixedErrors(fixture, "initial retained-prefix boundary stream");

    const managedBefore = requiredRange(fixture, "managed");
    const tailBefore = requiredRange(fixture, "tail");
    assertEqual(managedBefore.start, 1, "managed start before ReplaceSuffix");
    assertEqual(managedBefore.lineCount, 1, "managed rows before ReplaceSuffix");
    assertEqual(tailBefore.start, 2, "tail start before ReplaceSuffix");
    assertBufferRows(fixture.terminal, [
      "ordinary",
      "prefix-old",
      "tail",
      "",
    ]);

    selectAcrossRows(fixture.terminal, 3, 0, 6, managedBefore.start);
    assertSelectionPosition(
      fixture.terminal,
      3,
      0,
      6,
      managedBefore.start,
      "retained-prefix selection before ReplaceSuffix",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "inary\nprefix",
      "retained-prefix selection before ReplaceSuffix",
    );

    await fixture.ingress.push(
      encodeInput(
        replaceSuffix(
          fixture.contextId,
          "3",
          "managed",
          "1",
          6,
          "-replacement",
        ),
        5,
      ),
    );
    assertNoMixedErrors(fixture, "unselected suffix replacement");

    const managedAfter = requiredRange(fixture, "managed");
    const tailAfter = requiredRange(fixture, "tail");
    assertEqual(managedAfter.start, 1, "managed start after ReplaceSuffix");
    assertEqual(managedAfter.lineCount, 1, "managed rows after ReplaceSuffix");
    assertEqual(tailAfter.start, 2, "tail start after ReplaceSuffix");
    assertSelectionPosition(
      fixture.terminal,
      3,
      0,
      6,
      managedAfter.start,
      "retained-prefix selection after ReplaceSuffix",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "inary\nprefix",
      "retained-prefix selection after ReplaceSuffix",
    );
    assertBufferRows(fixture.terminal, [
      "ordinary",
      "prefix-replacement",
      "tail",
      "",
    ]);
    assertBlockContent(fixture, "managed", "prefix-replacement");
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after preserving the retained-prefix selection",
    );
    return {
      name:
        "ReplaceSuffix Preserves an Unmanaged-to-Managed Selection Ending in the Retained Prefix",
      detail:
        "replacing the unselected suffix left both endpoints and copied text unchanged",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runReplaceSuffixClearsMixedRemovedSuffixSelectionScenario(): Promise<ScenarioResult> {
  const fixture = await createMixedFixture({ cols: 20, rows: 4 });
  try {
    await fixture.ingress.push(
      concatenate([
        encodeInput(
          append(
            fixture.contextId,
            "1",
            "managed",
            "prefix-old",
            "mutable",
          ),
          3,
        ),
        text("ordinary\r\n"),
        encodeInput(
          append(fixture.contextId, "2", "tail", "tail", "sealed"),
          4,
        ),
      ]),
    );
    assertNoMixedErrors(fixture, "initial removed-suffix boundary stream");

    const managedBefore = requiredRange(fixture, "managed");
    const tailBefore = requiredRange(fixture, "tail");
    assertEqual(managedBefore.start, 0, "managed start before ReplaceSuffix");
    assertEqual(managedBefore.lineCount, 1, "managed rows before ReplaceSuffix");
    assertEqual(tailBefore.start, 2, "tail start before ReplaceSuffix");
    assertBufferRows(fixture.terminal, [
      "prefix-old",
      "ordinary",
      "tail",
      "",
    ]);

    selectAcrossRows(fixture.terminal, 3, managedBefore.start, 4, 1);
    assertSelectionPosition(
      fixture.terminal,
      3,
      managedBefore.start,
      4,
      1,
      "removed-suffix selection before ReplaceSuffix",
    );
    assertSelectionAndCopy(
      fixture.terminal,
      "fix-old\nordi",
      "removed-suffix selection before ReplaceSuffix",
    );

    await fixture.ingress.push(
      encodeInput(
        replaceSuffix(
          fixture.contextId,
          "3",
          "managed",
          "1",
          6,
          "-replacement",
        ),
        5,
      ),
    );
    assertNoMixedErrors(fixture, "selected suffix replacement");

    assertEqual(
      fixture.terminal.hasSelection(),
      false,
      "selection after replacing its selected suffix",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition(),
      undefined,
      "selection position after replacing its selected suffix",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "",
      "selection text after replacing its selected suffix",
    );
    assertEqual(
      copySelection(fixture.terminal),
      undefined,
      "copy event after replacing its selected suffix",
    );
    assertBufferRows(fixture.terminal, [
      "prefix-replacement",
      "ordinary",
      "tail",
      "",
    ]);
    assertBlockContent(fixture, "managed", "prefix-replacement");
    assertEqual(
      requiredRange(fixture, "managed").start,
      0,
      "managed start after ReplaceSuffix",
    );
    assertEqual(
      requiredRange(fixture, "tail").start,
      2,
      "tail start after ReplaceSuffix",
    );
    assertEqual(
      fixture.endpoint.context(fixture.contextId)?.state,
      "open",
      "Context after clearing the removed-suffix selection",
    );
    return {
      name:
        "ReplaceSuffix Clears a Managed-to-Unmanaged Selection That Includes the Removed Suffix",
      detail:
        "replacing selected suffix content cleared the complete cross-boundary copy source",
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
