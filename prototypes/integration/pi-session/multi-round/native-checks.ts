import { terminal, history, settleHost } from "../../../../examples/terminal-host/main.ts";

const text = (id: string) => document.getElementById(id)?.textContent ?? "";
function assert(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
function click(id: string) { (document.getElementById(id) as HTMLButtonElement).click(); }
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 30_000;
  while (!predicate()) {
    const status = text("status");
    assert(!status.startsWith("Stopped:") && status !== "Child exited: 1", status);
    assert(Date.now() < deadline, "Native check timed out");
    await new Promise(resolve => setTimeout(resolve, 20));
    await settleHost();
  }
  await settleHost();
}
function copy() {
  let copied: string | undefined;
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { setData(type: string, value: string) { if (type === "text/plain") copied = value; } } });
  terminal.element!.dispatchEvent(event);
  return copied;
}
function locate(marker: string) {
  const buffer = terminal.buffer.normal;
  for (let row = 0; row < buffer.length; row++) {
    const column = buffer.getLine(row)?.translateToString(true).indexOf(marker) ?? -1;
    if (column >= 0) return { row, column };
  }
  throw new Error(`No retained ${marker}`);
}

/** Explicit local-fixture action; absent from the live page. Uses real browser selection/copy handling. */
export function installNativeChecks() {
  const button = document.querySelector<HTMLButtonElement>("#native-checks");
  if (!button) return;
  const result = document.getElementById("native-results")!;
  button.onclick = async () => {
    button.disabled = true;
    const connect = document.getElementById("connect") as HTMLButtonElement;
    if (connect.disabled) { result.textContent = "Reload before running checks; they require a fresh connection."; return; }
    result.textContent = "Running local fixture only…";
    const ready = (round: number) => until(() => text("rendered").includes(`[ready ${round}/5]`));
    const submit = (prompt: string) => { (document.getElementById("prompt") as HTMLTextAreaElement).value = prompt; click("send"); };
    try {
      click("connect"); await ready(1);
      submit("NATIVE-ANCHOR\n" + Array.from({ length: 24 }, (_, i) => `history line ${i + 1}`).join("\n")); await ready(2);
      const match = locate("NATIVE-ANCHOR");
      terminal.scrollToLine(Math.max(0, match.row - 2)); terminal.select(match.column, match.row, "NATIVE-ANCHOR".length);
      const screenRow = match.row - terminal.buffer.normal.viewportY;
      assert(terminal.buffer.normal.viewportY < terminal.buffer.normal.baseY, "Must read above the bottom");
      assert(copy() === "NATIVE-ANCHOR", "Initial copy source differs");
      const preserved = () => {
        assert(locate("NATIVE-ANCHOR").row - terminal.buffer.normal.viewportY === screenRow, "Reading row moved");
        assert(terminal.getSelection() === "NATIVE-ANCHOR" && copy() === "NATIVE-ANCHOR", "Selection/copy changed");
      };
      submit("second prompt");
      await until(() => text("report").includes('pi-2: mutable; "Assistant:\\nReading"'));
      preserved(); await ready(3); preserved();
      result.textContent = "PASS: old reading row, selection, and copy survive a new turn during streaming and after completion.\n";
      submit("cancel during tool");
      await until(() => /pi-3: mutable; "Tool: read_trial_sample\\nReading sample/.test(text("report")));
      click("cancel"); await ready(4);
      assert(text("rendered").includes("[round 3 aborted]"), "Tool cancellation claimed success");
      assert(text("report").includes("[Tool error]"), "Missing settled cancelled-tool result");
      result.textContent += "PASS: tool cancellation closes the turn and leaves the conversation ready.\n";
      submit("cancel during answer");
      await until(() => text("report").includes('pi-2: mutable; "Assistant:\\nReading"'));
      click("cancel"); await ready(5);
      assert(text("rendered").includes("[round 4 aborted]"), "Assistant cancellation claimed success");
      submit("continue after both cancels"); await until(() => text("status") === "Child exited: 0");
      assert(text("report").endsWith("Context states before EOF: closed, closed, closed, closed, closed"), "Missing explicit Context closures");
      assert(text("rendered").includes("[trial round limit reached]"), "Missing finite-round stop");
      result.textContent += "PASS: after assistant cancellation, another prompt completes; the five-turn limit exits cleanly.\n";
      assert(history.findNext("NATIVE-ANCHOR"), "Old content is no longer searchable");
      assert(terminal.getSelection() === "NATIVE-ANCHOR" && copy() === "NATIVE-ANCHOR", "Search/copy differs after exit");
      result.textContent += "PASS: earlier history remains searchable and copyable after all five Contexts close.\n4 multi-round native/lifecycle scenarios passed (local fixture; in-memory copy-event sink, not OS clipboard).";
    } catch (error) { result.textContent += `\nFAIL: ${String(error)}`; click("disconnect"); }
  };
}
