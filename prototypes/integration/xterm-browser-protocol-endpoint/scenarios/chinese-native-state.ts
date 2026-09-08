import {
  append, assertBlockContent, assertEqual, assertInputStateUnchanged, assertTrue,
  copySelection, createFixture, extend, inputSnapshot, nextTurn, pushMessages,
  replaceSuffix, requiredCompositionView, requiredRange, requiredTextarea, update, write,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

export async function runChineseReadingReflowScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 3 });
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "earlier", "中文\t结果", "mutable"),
      append(fixture.contextId, "2", "reader", "阅读", "sealed"),
      append(fixture.contextId, "3", "tail", "一\n二\n三\n四\n五", "sealed"),
    ]);
    await fixture.endpoint.drain();
    fixture.terminal.scrollToLine(requiredRange(fixture, "reader").start);
    fixture.terminal.select(0, requiredRange(fixture, "reader").start, 4);
    for (const cols of [5, 9, 20]) {
      fixture.endpoint.resize(cols, 3);
      const reader = requiredRange(fixture, "reader");
      assertEqual(fixture.terminal.buffer.active.viewportY, reader.start, "Chinese reader remains at viewport top after resize to " + cols);
      assertEqual(copySelection(fixture.terminal), "阅读", "same Chinese selection after reflow");
    }
    pushMessages(fixture.endpoint, [update(fixture.contextId, "4", "earlier", "前\n面\n增长")]);
    await fixture.endpoint.drain();
    assertEqual(fixture.terminal.buffer.active.viewportY, requiredRange(fixture, "reader").start, "reader survives earlier Update after reflow");
    assertEqual(copySelection(fixture.terminal), "阅读", "reading selection survives earlier Update");
    fixture.terminal.clearSelection();
    fixture.terminal.scrollToBottom();
    fixture.endpoint.resize(5, 3);
    pushMessages(fixture.endpoint, [extend(fixture.contextId, "5", "earlier", "4", "更多内容")]);
    await fixture.endpoint.drain();
    assertEqual(fixture.terminal.buffer.active.viewportY, fixture.terminal.buffer.active.baseY, "tail following survives reflow and Extend");
    assertBlockContent(fixture, "earlier", "前\n面\n增长更多内容");
    return { name: "Chinese Reflow Preserves Reading and Later Tail Following",
      detail: "the selected reader stayed at viewport top through resizing and Update, then explicit tail following survived Extend" };
  } finally { fixture.dispose(); }
}

export async function runChineseHistoryPreservesInputScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 4 });
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "history", "中文\t结果", "mutable"),
      append(fixture.contextId, "2", "tail", "一\n二\n三\n四", "sealed"),
    ]);
    await fixture.endpoint.drain();
    await write(fixture.terminal, "> edit\x1b[2D");
    fixture.terminal.focus();
    const before = inputSnapshot(fixture.terminal);
    const textarea = requiredTextarea(fixture.terminal);
    const view = requiredCompositionView(fixture.terminal);
    let ended = 0;
    let sent = "";
    textarea.addEventListener("compositionend", () => { ended += 1; });
    const registration = fixture.terminal.onData(data => { sent += data; });
    try {
      textarea.value = "";
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      textarea.value = "拼";
      textarea.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "拼" }));
      await nextTurn();
      const check = async (label: string): Promise<void> => {
        await fixture.endpoint.drain();
        await nextTurn();
        assertInputStateUnchanged(inputSnapshot(fixture.terminal), before, label);
        assertEqual(ended, 0, label + " does not end synthetic composition");
        assertEqual(sent, "", label + " does not send input");
        assertEqual(textarea.value, "拼", label + " preserves pending textarea text");
        assertEqual(view.textContent, "拼", label + " preserves composition text");
        assertTrue(view.classList.contains("active"), label + " keeps composition active");
      };
      fixture.endpoint.resize(9, 4);
      await check("Chinese history reflow");
      pushMessages(fixture.endpoint, [extend(fixture.contextId, "3", "history", "1", "追加内容")]);
      await check("Chinese Extend");
      pushMessages(fixture.endpoint, [replaceSuffix(fixture.contextId, "4", "history", "3", 3, "新")]);
      await check("Chinese ReplaceSuffix");
      pushMessages(fixture.endpoint, [update(fixture.contextId, "5", "history", "全新\t内容")]);
      await check("Chinese Update");
      assertBlockContent(fixture, "history", "全新\t内容");
      textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "拼" }));
      await nextTurn();
    } finally { registration.dispose(); }
    return { name: "Chinese History Changes Preserve Active Input and Synthetic Composition",
      detail: "reflow, Extend, ReplaceSuffix, and Update kept the input text, cursor, focus, and pending composition" };
  } finally { fixture.dispose(); }
}
