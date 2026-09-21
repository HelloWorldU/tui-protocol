import "../../../../examples/terminal-host/style.css";
const run = document.querySelector<HTMLButtonElement>("#run")!;
const results = document.querySelector<HTMLElement>("#results")!;
const text = (doc: Document, id: string) => doc.getElementById(id)?.textContent ?? "";
function assert(value: boolean, reason: string): asserts value { if (!value) throw new Error(reason); }
function click(doc: Document, id: string) { (doc.getElementById(id) as HTMLButtonElement).click(); }
function until(doc: Document, predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => { observer.disconnect(); clearTimeout(timer); error ? reject(error) : resolve(); };
    const inspect = () => {
      const status = text(doc, "status");
      if (status.startsWith("Stopped:") || status === "Child exited: 1") finish(new Error(status));
      else if (predicate()) finish();
    };
    const observer = new MutationObserver(inspect);
    const timer = setTimeout(() => finish(new Error("Expected round state did not arrive")), 30_000);
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true }); inspect();
  });
}
run.onclick = async () => {
  run.disabled = true; results.textContent = "Running…";
  const frame = document.createElement("iframe"); frame.title = "Multi-round trial under test";
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Frame did not load")), 15_000);
      frame.onload = () => { clearTimeout(timer); resolve(); };
    });
    frame.src = "/"; document.getElementById("example")!.replaceChildren(frame); await loaded;
    const doc = frame.contentDocument!;
    const ready = (round: number) => until(doc, () => text(doc, "rendered").includes(`[ready ${round}/5]`));
    const submit = (prompt: string) => { (doc.getElementById("prompt") as HTMLTextAreaElement).value = prompt; click(doc, "send"); };
    click(doc, "connect"); await ready(1);
    submit("remember alpha 中文 😀"); await ready(2);
    submit("follow up beta"); await ready(3);
    assert(text(doc, "report").includes("Previous prompt: remember alpha"), "Pi did not retain the earlier prompt");
    assert((text(doc, "report").match(/: closed/g) ?? []).length === 2, "Expected two explicitly closed Contexts");
    results.textContent = "PASS: two entered prompts share Pi conversation history and close separate display Contexts.\n";
    submit("cancel this gamma");
    await until(doc, () => /pi-2: mutable; "Assistant:\\nReading"/.test(text(doc, "report")));
    click(doc, "cancel"); await ready(4);
    assert(text(doc, "report").includes("[aborted]"), "Missing retained partial output");
    assert(text(doc, "rendered").includes("[round 3 aborted]"), "Cancelled turn claimed completion");
    submit("continue delta"); await ready(5);
    assert(text(doc, "report").includes("Previous prompt: cancel this gamma"), "Conversation lost the cancelled user turn");
    results.textContent += "PASS: cancellation retains partial output; the same Pi session accepts and completes another turn.\n";
    (doc.getElementById("query") as HTMLInputElement).value = "remember alpha"; click(doc, "search");
    assert(text(doc, "search-result") === "Found: remember alpha", "Old prompt no longer searchable");
    click(doc, "end"); await until(doc, () => text(doc, "status") === "Child exited: 0");
    assert(text(doc, "report").endsWith("Context states before EOF: closed, closed, closed, closed"), "Unclosed Context at exit");
    results.textContent += "PASS: earlier history remains searchable; ending idle confirms child exit 0 and all four Contexts closed.\n3 Pi multi-round browser scenarios passed (local fixture, Windows ConPTY, experimental xterm).";
  } catch (error) { results.textContent += `\nFAIL: ${String(error)}`; frame.remove(); }
  finally { run.disabled = false; }
};
