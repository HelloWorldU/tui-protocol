import "../terminal-host/style.css";

const run = document.querySelector<HTMLButtonElement>("#run")!;
const results = document.querySelector<HTMLElement>("#results")!;
const host = document.querySelector<HTMLElement>("#example")!;
const text = (doc: Document, id: string) => doc.getElementById(id)?.textContent ?? "";
function assert(value: boolean, reason: string): asserts value { if (!value) throw new Error(reason); }
function click(doc: Document, id: string) {
  const button = doc.getElementById(id) as HTMLButtonElement;
  assert(button !== null && !button.disabled, `${id} unavailable`);
  button.click();
}
function until(doc: Document, predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      observer.disconnect(); clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const inspect = () => {
      if (text(doc, "status").startsWith("Stopped:")) finish(new Error(text(doc, "status")));
      else if (predicate()) finish();
    };
    const observer = new MutationObserver(inspect);
    const timer = setTimeout(() => finish(new Error("Expected application state did not arrive within 20 seconds")), 20_000);
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true });
    inspect();
  });
}
async function fresh(): Promise<Document> {
  host.replaceChildren();
  const frame = document.createElement("iframe");
  frame.title = "Multi-round application under test";
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Example failed to load")), 15_000);
    frame.onload = () => { clearTimeout(timer); resolve(); };
    frame.onerror = () => { clearTimeout(timer); reject(new Error("Example failed to load")); };
  });
  frame.src = "/"; host.append(frame); await loaded;
  assert(frame.contentDocument !== null, "No iframe document");
  return frame.contentDocument;
}
function search(doc: Document, query: string, expected: string) {
  (doc.getElementById("query") as HTMLInputElement).value = query;
  click(doc, "search");
  assert(text(doc, "search-result") === expected, `Search ${query}: ${text(doc, "search-result")}`);
}

run.onclick = async () => {
  run.disabled = true; results.textContent = "Running…";
  try {
    const doc = await fresh(); click(doc, "connect");
    for (let round = 1; round <= 3; round++) {
      await until(doc, () => text(doc, "rendered").includes(`[ready ${round}/3]`));
      click(doc, "next");
      await until(doc, () => text(doc, "report").includes(`answer-${round}: mutable;`));
      // Older output is searched while this round is still being revised.
      search(doc, `Tool ${round}:`, `Found: Tool ${round}:`);
      await until(doc, () => text(doc, "report").includes(`answer-${round}: sealed;`));
      assert(text(doc, "report").includes(`thinking-${round}: sealed; "Thinking ${round}: complete"`), "Thinking did not finalize");
    }
    await until(doc, () => text(doc, "status") === "Child exited: 0");
    assert(text(doc, "report").endsWith("Context states before EOF: closed"), "Missing explicit close before EOF");
    const rows = text(doc, "rendered");
    for (let round = 1; round <= 3; round++) {
      assert(rows.split(`Round ${round}: inspect`).length === 2, "Prompt duplicated or missing");
      assert(rows.split(`Tool ${round}: simulated`).length === 2, "Tool output duplicated or missing");
      search(doc, `Answer ${round}: result`, `Found: Answer ${round}: result`);
    }
    search(doc, "drafting", "No match"); search(doc, "Gathering context", "No match");
    assert(!text(doc, "report").includes("prompt-4:"), "Fourth round appeared");
    results.textContent = "PASS: three commanded rounds retain final output once and remove replaced text from search.\nChecking quit…";

    const quit = await fresh(); click(quit, "connect");
    await until(quit, () => text(quit, "rendered").includes("[ready 1/3]")); click(quit, "next");
    await until(quit, () => text(quit, "report").includes("thinking-1: mutable;")); click(quit, "quit");
    await until(quit, () => text(quit, "status") === "Child exited: 0");
    assert(text(quit, "report").endsWith("Context states before EOF: closed"), "Quit did not close Context");
    assert(!text(quit, "report").includes("answer-1:") && !text(quit, "report").includes("prompt-2:"), "Quit continued generating");
    assert(text(quit, "report").includes("thinking-1: sealed;"), "Partial content not retained on closure");
    assert(text(quit, "rendered").includes("[stopped by user]"), "Quit incorrectly claimed completion");
    results.textContent = "PASS: three commanded rounds retain final output once and remove replaced text from search.\nPASS: quit during generation retains partial content and explicitly closes without generating another round.\n2 browser scenarios passed.";
  } catch (error) {
    results.textContent += `\nFAIL: ${String(error)}`; host.replaceChildren();
  } finally { run.disabled = false; }
};
