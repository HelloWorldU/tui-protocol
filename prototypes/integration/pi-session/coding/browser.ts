import "../multi-round/browser.ts";
import { history, terminal, settleHost } from "../../../../examples/terminal-host/main.ts";

document.querySelector<HTMLButtonElement>("#followup")!.onclick = () => {
  document.querySelector<HTMLTextAreaElement>("#prompt")!.value = "Without changing files, run the tests again and explain why the quantity fix works, including zero quantity. Use the same project from the previous turn.";
};
document.querySelector<HTMLButtonElement>("#check-history")!.onclick = async () => {
  const result = document.getElementById("check-result")!;
  try {
    await settleHost();
    const report = document.getElementById("report")!.textContent ?? "";
    const assert = (value: unknown, reason: string) => { if (!value) throw new Error(reason); };
    assert(report.includes("CODING TESTS: 3 passed, 3 failed"), "Missing failing baseline");
    assert(report.includes("CODING TESTS: 6 passed, 0 failed"), "Missing passing rerun");
    assert(report.includes("Updated total.mjs"), "Missing file edit result");
    assert(history.findNext("FAIL multiple units"), "Original test failure is not searchable");
    let copied = "";
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: { setData(_type: string, value: string) { copied = value; } } });
    terminal.element!.dispatchEvent(copy);
    assert(copied === "FAIL multiple units", "Failure copy text differs");
    assert(history.findNext("PASS multiple units"), "Passing result is not searchable");
    result.textContent = "PASS: failing baseline, edit result, and passing tests remain in history; the earlier failure is searchable and copies unchanged (copy-event sink).";
  } catch (error) { result.textContent = `FAIL: ${String(error)}`; }
};
