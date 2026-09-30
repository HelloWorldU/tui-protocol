import "../../../examples/terminal-host/style.css";

const run = document.querySelector<HTMLButtonElement>("#run")!;
const results = document.querySelector<HTMLElement>("#results")!;
const host = document.querySelector<HTMLElement>("#example")!;
const PROMPT = "Read the trial sample using read_trial_sample, then give a brief answer.";
const RESULT_LINE = "Result: mutable history keeps old output readable.";
const TOOL_LINE = "Trial sample: mutable history keeps old output readable.";

const text = (doc: Document, id: string) => doc.getElementById(id)?.textContent ?? "";
function assert(value: boolean, reason: string): asserts value { if (!value) throw new Error(reason); }
function count(haystack: string, needle: string): number { return haystack.split(needle).length - 1; }
function click(doc: Document, id: string) {
  const button = doc.getElementById(id) as HTMLButtonElement;
  assert(button !== null && !button.disabled, `${id} unavailable`);
  button.click();
}
function until(doc: Document, predicate: () => boolean, reason: string): Promise<void> {
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
    const timer = setTimeout(() => finish(new Error(
      `Timed out: ${reason}\n[status] ${text(doc, "status")}\n[report] ${text(doc, "report") || "(empty)"}\n[rendered tail] ${text(doc, "rendered").split("\n").slice(-14).join("\n")}`,
    )), 30_000);
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true });
    inspect();
  });
}
async function fresh(stock = false): Promise<Document> {
  host.replaceChildren();
  const frame = document.createElement("iframe");
  frame.title = "Pi stock-UI trial under test";
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Trial page failed to load")), 15_000);
    frame.onload = () => { clearTimeout(timer); resolve(); };
    frame.onerror = () => { clearTimeout(timer); reject(new Error("Trial page failed to load")); };
  });
  frame.src = stock ? "/?stock=1" : "/";
  host.append(frame);
  await loaded;
  assert(frame.contentDocument !== null, "No iframe document");
  return frame.contentDocument;
}
async function typePrompt(doc: Document, started: () => boolean, value = PROMPT) {
  (doc.getElementById("typetext") as HTMLInputElement).value = value;
  click(doc, "type");
  // Pi bounces submissions that arrive before its startup finishes ("Startup is
  // still in progress") and keeps the text in the editor, so re-submit until the
  // turn starts instead of assuming the first Enter lands.
  const deadline = Date.now() + 25_000;
  for (;;) {
    if (started()) return;
    const status = text(doc, "status");
    if (status.startsWith("Stopped:") || status === "Child exited: 1") throw new Error(status);
    if (Date.now() > deadline) {
      throw new Error(`Timed out: prompt turn to start\n[rendered tail] ${text(doc, "rendered").split("\n").slice(-14).join("\n")}`);
    }
    click(doc, "enter");
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}
function turnStarted(doc: Document): boolean {
  return /Context context-\d+: open/.test(text(doc, "report"));
}
function search(doc: Document, query: string, expected: string) {
  (doc.getElementById("query") as HTMLInputElement).value = query;
  click(doc, "search");
  assert(text(doc, "search-result") === expected, `Search ${query}: ${text(doc, "search-result")}`);
}

run.onclick = async () => {
  run.disabled = true; results.textContent = "Running…";
  try {
    // Scenario 1: one protocol turn completes; the editor accepts input during streaming.
    const doc = await fresh(); click(doc, "connect");
    await until(doc, () => text(doc, "rendered").includes("[pi-stock-ui] protocol supported"), "negotiation notice");
    await until(doc, () => text(doc, "rendered").includes("0.87.1"), "Pi chrome header");
    await typePrompt(doc, () => turnStarted(doc));
    await until(doc, () => text(doc, "report").includes("pi-2:"), "assistant Block streaming");
    (doc.getElementById("typetext") as HTMLInputElement).value = "draft";
    click(doc, "type");
    await until(doc, () => text(doc, "rendered").includes("draft"), "editor echo during streaming");
    await until(doc, () => text(doc, "report").includes("Context context-1: closed"), "turn Context to close");
    const report1 = text(doc, "report");
    assert((report1.match(/pi-\d+: sealed;/g) ?? []).length === 4, `Expected four sealed Blocks: ${report1}`);
    assert(report1.includes('"User:\\n' + PROMPT + '"'), "User Block content wrong");
    const rendered1 = text(doc, "rendered");
    assert(count(rendered1, RESULT_LINE) === 1, `Result line x${count(rendered1, RESULT_LINE)} in native rows`);
    assert(count(rendered1, TOOL_LINE) === 1, `Tool line x${count(rendered1, TOOL_LINE)} in native rows`);
    assert(count(rendered1, "draft") >= 1 && !report1.includes("draft"), "editor draft leaked into a Block");
    search(doc, "Result:", "Found: Result:");
    results.textContent = "PASS: one turn completes with the transcript in four sealed Blocks; the editor accepted input during streaming; transcript text appears exactly once in native rows.\nChecking cancel…";

    // Scenario 2: cancel mid-stream, then a further turn completes in the same session.
    const stopped = await fresh(); click(stopped, "connect");
    await until(stopped, () => text(stopped, "rendered").includes("[pi-stock-ui] protocol supported"), "negotiation notice");
    await typePrompt(stopped, () => turnStarted(stopped));
    await until(stopped, () => text(stopped, "report").includes("pi-2:"), "assistant Block streaming");
    click(stopped, "escape");
    await until(stopped, () => text(stopped, "report").includes("Context context-1: closed"), "cancelled turn Context to close");
    const report2 = text(stopped, "report");
    assert(report2.includes("[aborted]"), "Partial assistant output has no abort label");
    assert(!report2.includes("pi-3:"), "Tool started after early cancellation");
    assert(count(text(stopped, "rendered"), RESULT_LINE) === 0, "Result line rendered despite cancellation");
    (stopped.getElementById("typetext") as HTMLInputElement).value = "zz";
    click(stopped, "type");
    await until(stopped, () => text(stopped, "rendered").includes("zz"), "editor echo after cancellation");
    // The echo text stays in Pi's editor; delete it so the next prompt submits clean.
    click(stopped, "backspace");
    click(stopped, "backspace");
    await typePrompt(stopped, () => turnStarted(stopped));
    await until(stopped, () => text(stopped, "report").includes("Context context-2: closed"), "second turn Context to close");
    const secondTurn = text(stopped, "report").split("Context context-2:")[1] ?? "";
    assert((secondTurn.match(/pi-\d+: sealed;/g) ?? []).length === 4, "Second turn did not produce four sealed Blocks");
    results.textContent += "PASS: cancel mid-stream keeps a sealed partial Block with an abort label, the tool never runs, the editor stays responsive, and a further prompt completes.\nChecking resize…";

    // Scenario 3: resize 60 to 36 and back after streaming; transcript and chrome survive.
    const sized = await fresh(); click(sized, "connect");
    await until(sized, () => text(sized, "rendered").includes("[pi-stock-ui] protocol supported"), "negotiation notice");
    await typePrompt(sized, () => turnStarted(sized));
    await until(sized, () => text(sized, "report").includes("Context context-1: closed"), "turn Context to close");
    assert(text(sized, "geometry") === "60x24", "Unexpected starting geometry");
    click(sized, "resize");
    await until(sized, () => text(sized, "geometry") === "36x24", "narrow geometry");
    await new Promise(resolve => setTimeout(resolve, 400));
    assert(text(sized, "report").includes("pi-4: sealed;"), "Blocks lost at 36 columns");
    (sized.getElementById("typetext") as HTMLInputElement).value = "zz";
    click(sized, "type");
    await until(sized, () => text(sized, "rendered").includes("zz"), "editor echo at 36 columns");
    click(sized, "resize");
    await until(sized, () => text(sized, "geometry") === "60x24", "restored geometry");
    await new Promise(resolve => setTimeout(resolve, 400));
    const rendered3 = text(sized, "rendered");
    assert(count(rendered3, RESULT_LINE) === 1, `Result line x${count(rendered3, RESULT_LINE)} after resize round trip`);
    assert(count(rendered3, TOOL_LINE) === 1, `Tool line x${count(rendered3, TOOL_LINE)} after resize round trip`);
    const tailRows = rendered3.split("\n").slice(-6).join("\n").trim();
    assert(tailRows.length > 0, "Chrome rows below the transcript went blank after resize");
    search(sized, "Result:", "Found: Result:");
    results.textContent += "PASS: a 60/36/60 column round trip keeps sealed Blocks, exactly one copy of each transcript line, a live editor, and non-blank chrome.\nChecking stock fallback…";

    // Scenario 4: trial flag off — the same host sees a stock Pi, no protocol state.
    const plain = await fresh(true); click(plain, "connect");
    await until(plain, () => text(plain, "rendered").includes("[pi-stock-ui] protocol disabled by trial flag"), "flag notice");
    await typePrompt(plain, () => text(plain, "rendered").includes("Working"));
    await until(plain, () => text(plain, "rendered").includes(RESULT_LINE), "Pi-rendered assistant text");
    assert(text(plain, "report").includes("No Contexts"), "Protocol state appeared with the trial flag off");
    assert(count(text(plain, "rendered"), RESULT_LINE) >= 1, "Stock transcript missing from native rows");
    results.textContent += "PASS: with the trial flag off, Pi renders its own transcript through the same host and no protocol state appears.\n4 Pi stock-UI browser scenarios passed (local model fixture, no live model).";
  } catch (error) {
    results.textContent += `\nFAIL: ${String(error)}`; host.replaceChildren();
  } finally { run.disabled = false; }
};
