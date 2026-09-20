import "../../../examples/terminal-host/style.css";

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
      const status = text(doc, "status");
      if (status.startsWith("Stopped:") || status === "Child exited: 1") finish(new Error(status));
      else if (predicate()) finish();
    };
    const observer = new MutationObserver(inspect);
    const timer = setTimeout(() => finish(new Error("Expected Pi trial state did not arrive within 30 seconds")), 30_000);
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true });
    inspect();
  });
}
async function fresh(): Promise<Document> {
  host.replaceChildren();
  const frame = document.createElement("iframe");
  frame.title = "Pi session trial under test";
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Trial page failed to load")), 15_000);
    frame.onload = () => { clearTimeout(timer); resolve(); };
    frame.onerror = () => { clearTimeout(timer); reject(new Error("Trial page failed to load")); };
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
    await until(doc, () => text(doc, "rendered").includes("[ready]")); click(doc, "next");
    await until(doc, () => text(doc, "report").includes("pi-4: mutable;"));
    search(doc, "Trial sample:", "Found: Trial sample:");
    await until(doc, () => text(doc, "status") === "Child exited: 0");
    assert(text(doc, "report").endsWith("Context states before EOF: closed"), "Missing explicit close before EOF");
    assert((text(doc, "report").match(/pi-\d+: sealed;/g) ?? []).length === 4, "Expected four sealed Blocks");
    assert(text(doc, "rendered").split("Trial sample:").length === 2, "Tool result missing or duplicated in native rows");
    search(doc, "Result:", "Found: Result:");
    search(doc, "[Running]", "No match");
    assert(text(doc, "rendered").includes("[Pi turn complete]"), "Missing application completion marker");
    results.textContent = "PASS: real Pi session + local provider completes through ConPTY and xterm; tool result appears once and remains searchable.\nChecking cancel…";

    const stopped = await fresh(); click(stopped, "connect");
    await until(stopped, () => text(stopped, "rendered").includes("[ready]")); click(stopped, "next");
    await until(stopped, () => text(stopped, "report").includes('pi-2: mutable; "Assistant:\\nReading"')); click(stopped, "quit");
    await until(stopped, () => text(stopped, "status") === "Child exited: 0");
    assert(text(stopped, "report").endsWith("Context states before EOF: closed"), "Cancel did not explicitly close Context");
    assert(text(stopped, "report").includes("[aborted]"), "Partial assistant output has no abort label");
    assert(!text(stopped, "report").includes("pi-3:"), "Tool started after early cancellation");
    assert(text(stopped, "rendered").includes("[stopped by user]"), "Cancel claimed normal completion");
    search(stopped, "Reading", "Found: Reading");
    search(stopped, "Result:", "No match");
    results.textContent = "PASS: real Pi session + local provider completes through ConPTY and xterm; tool result appears once and remains searchable.\nPASS: cancelling a streamed response retains searchable partial content, closes the Context, and prevents tool execution.\n2 Pi browser scenarios passed (local model fixture, no live model).";
  } catch (error) {
    results.textContent += `\nFAIL: ${String(error)}`; host.replaceChildren();
  } finally { run.disabled = false; }
};
