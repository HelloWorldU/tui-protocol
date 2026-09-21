import "@xterm/xterm/css/xterm.css";
import { ComparisonHost, assert, type Mode } from "./browser-host.ts";
import { HISTORY_MARK, LATER_MARK, PROGRESS_MARK, SUMMARY, FINAL, numbered } from "./samples.ts";

const run = document.querySelector<HTMLButtonElement>("#run")!;
const status = document.querySelector<HTMLElement>("#status")!;
const results = document.querySelector<HTMLElement>("#results")!;
const evidence = document.querySelector<HTMLElement>("#evidence")!;
const element = document.querySelector<HTMLElement>("#terminal")!;
type Observation = ReturnType<ComparisonHost["observe"]>;
interface Result { name: string; mode: Mode; before: Observation; after: Observation; checks: Record<string, boolean>; detail?: unknown }

const preserved = (a: Observation, b: Observation) => ({
  unique: b.occurrences === 1, readingPosition: a.screenRow === b.screenRow && b.visible,
  selection: b.selected === a.selected, copy: b.copied === a.copied && b.copied !== undefined,
});
const records: Result[] = [];
const markerGroups = [["HISTORY", 24], ["STREAM", 18], ["CONTINUE", 18], ["LATER", 20]] as const;
function currentContentOnce(host: ComparisonHost): boolean {
  const withoutLayoutWhitespace = host.text().replace(/\s/g, "");
  return markerGroups.every(([prefix, count]) => numbered(prefix, count).split("\n").every(line =>
    host.matches(line.split(" ")[0]).length === 1 && withoutLayoutWhitespace.includes(line.replace(/\s/g, "")),
  ));
}
function show() {
  evidence.textContent = JSON.stringify(records, null, 2);
  const table = document.createElement("table");
  const header = table.insertRow();
  for (const text of ["Scenario", "Frontend", "Expected", "Observed checks"]) { const cell = document.createElement("th"); cell.textContent = text; header.append(cell); }
  for (const record of records) {
    const row = table.insertRow();
    for (const text of [record.name, record.mode, "Retain reading/selection; current content once", Object.entries(record.checks).map(([key, value]) => `${key}: ${value ? "yes" : "NO"}`).join("; ")]) row.insertCell().textContent = text;
  }
  results.replaceChildren(table);
}
async function compare(mode: Mode) {
  status.textContent = `${mode}: starting actual Pi session…`;
  const host = new ComparisonHost(mode, element);
  try {
    await host.until(() => host.controls.some(c => c.type === "ready"), "worker startup");
    host.send({ type: "start" });
    await host.until(() => host.text().includes("STREAM-17"), "initial stream");
    const before = host.readAndSelect(HISTORY_MARK);
    host.send({ type: "release", gate: "stream" });
    await host.until(() => host.text().includes("CONTINUE-17"), "continued stream");
    const after = host.observe(HISTORY_MARK);
    records.push({ name: "Read history while streaming", mode, before, after, checks: {
      ...preserved(before, after), finalFragment: host.matches("CONTINUE-17").length === 1,
    } }); show();

    status.textContent = `${mode}: earlier tool progress shrinks after later result…`;
    host.send({ type: "release", gate: "tools" });
    await host.until(() => host.text().includes("LATER-19") && host.events.some(e => e.type === "tool_execution_end" && e.toolCallId === "later-call"), "later tool result");
    assert(host.matches(PROGRESS_MARK).length === 1, "Earlier progress must still exist");
    assert(!host.events.some(e => e.type === "tool_execution_end" && e.toolCallId === "slow-call"), "Earlier tool must still be active");
    const toolBefore = host.readAndSelect(LATER_MARK);
    host.send({ type: "release", gate: "shrink" });
    await host.until(() => host.text().includes(SUMMARY) && host.events.some(e => e.type === "tool_execution_end" && e.toolCallId === "slow-call"), "short tool result");
    const toolAfter = host.observe(LATER_MARK);
    records.push({ name: "Earlier progress becomes short result", mode, before: toolBefore, after: toolAfter, checks: {
      ...preserved(toolBefore, toolAfter), obsoleteProgressRemoved: host.matches(PROGRESS_MARK).length === 0,
      summaryOnce: host.matches(SUMMARY).length === 1,
      obsoleteNotSearchable: !host.search.findNext(PROGRESS_MARK), summarySearchable: host.search.findNext(SUMMARY),
      laterSearchable: host.search.findNext(LATER_MARK),
    } }); show();
    host.send({ type: "release", gate: "final" });
    await host.until(() => host.controls.some(c => c.type === "complete"), "completed session");
    assert(host.matches(FINAL).length === 1, "Expected one final answer");

    status.textContent = `${mode}: narrow and widen while reading history…`;
    const resizeBefore = host.readAndSelect(HISTORY_MARK);
    await host.resize(36);
    const narrow = host.observe(HISTORY_MARK);
    const narrowContentOnce = currentContentOnce(host);
    await host.resize(60);
    const wide = host.observe(HISTORY_MARK);
    records.push({ name: "Resize while reading history", mode, before: resizeBefore, after: wide, checks: {
      narrowAnchorVisible: narrow.visible, wideAnchorVisible: wide.visible,
      narrowSelection: narrow.selected === HISTORY_MARK, wideSelection: wide.selected === HISTORY_MARK,
      narrowCopy: narrow.copied === HISTORY_MARK, wideCopy: wide.copied === HISTORY_MARK,
      narrowContentOnce, wideContentOnce: currentContentOnce(host),
    }, detail: { narrow, widths: [60, 36, 60], closedContexts: host.closedContexts() } }); show();
    const completion = host.controls.find(c => c.type === "complete");
    assert(completion?.type === "complete", "Missing completion control");
    assert(completion.requests === 2, "Expected exactly two fixed provider responses");
    if (mode === "protocol") {
      assert(host.closedContexts(), "Protocol Context must be explicitly closed");
      for (const record of records.filter(r => r.mode === mode)) assert(Object.values(record.checks).every(Boolean), `Protocol failed: ${record.name}`);
    }
    return JSON.stringify(completion.trace);
  } finally { await host.dispose(); }
}
run.onclick = async () => {
  run.disabled = true; records.length = 0; show();
  try {
    const regular = await compare("regular");
    const protocol = await compare("protocol");
    if (regular !== protocol) {
      const a = JSON.parse(regular) as unknown[];
      const b = JSON.parse(protocol) as unknown[];
      const index = a.findIndex((event, i) => JSON.stringify(event) !== JSON.stringify(b[i]));
      throw new Error(`The two Pi event traces differ at ${index}: ${JSON.stringify(a[index])} vs ${JSON.stringify(b[index])}`);
    }
    status.textContent = "3 paired scenarios recorded. Protocol assertions passed; Pi semantic event traces matched. Baseline differences are observations, not harness failures.";
  } catch (error) { status.textContent = `FAIL: ${String(error)}`; }
  finally { run.disabled = false; }
};
