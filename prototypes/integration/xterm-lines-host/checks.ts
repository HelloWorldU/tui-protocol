import { Terminal } from "@xterm/xterm";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import "@xterm/xterm/css/xterm.css";
import { TuiClient, type LinesTextLine, type TuiContext } from "@tui-protocol/sdk";
import { TerminalProtocolEndpoint } from "@tui-protocol/terminal";
import { installLinesCopy, selectMatch } from "./browser-wiring.ts";
import { XtermLinesHost } from "./lines-host.ts";
import fixture from "./pi-lines-fixture.json" with { type: "json" };

// Browser checks for the RFC 0003 text/lines host: Pi's recorded text/lines
// content (pi-lines-fixture.json) through the SDK, the terminal module's
// endpoint, and the host into a real xterm.js DOM terminal.

interface Fixture {
  readonly terminal: Terminal;
  readonly host: XtermLinesHost;
  readonly context: TuiContext;
  dispose(): void;
}

const samples = fixture.samples as Record<"wrap" | "cjk", { lines: LinesTextLine[]; layouts: Record<string, string[]> }>;

async function open(cols: number, rows: number, parent?: HTMLElement): Promise<Fixture> {
  const element = document.createElement("div");
  if (parent === undefined) element.className = "fixture";
  (parent ?? document.body).appendChild(element);
  const terminal = new Terminal({ cols, rows, scrollback: 1000 });
  terminal.open(element);
  const host = new XtermLinesHost(terminal as unknown as HeadlessTerminal);
  const endpoint = new TerminalProtocolEndpoint({
    completeBaselineSupported: true, optionalContentTypes: ["text/styled", "text/lines"], operationAdapter: host,
  });
  host.attach(endpoint);
  const removeCopy = installLinesCopy(terminal, host);
  const client = new TuiClient({ write(bytes) {
    const result = endpoint.push(bytes);
    if (result.diagnostics.length > 0) throw new Error(JSON.stringify(result.diagnostics));
    queueMicrotask(() => { for (const frame of result.responseFrames) client.receive(frame); });
  } });
  if (!(await client.negotiate()) || !client.supportsLinesContent) throw new Error("text/lines not confirmed");
  const context = await client.openContext();
  return {
    terminal, host, context,
    dispose() { removeCopy(); client.dispose(); terminal.dispose(); element.remove(); },
  };
}

function rows(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  const result: string[] = [];
  for (let index = 0; index < buffer.length; index++) result.push(buffer.getLine(index)?.translateToString(true) ?? "");
  while (result.at(-1) === "") result.pop();
  return result;
}

function painted(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** The DOM renderer element under one visible cell. */
function cell(terminal: Terminal, row: number, col: number): HTMLElement {
  const rowElement = terminal.element?.querySelector(".xterm-rows")?.children[row - terminal.buffer.active.viewportY];
  if (rowElement === undefined) throw new Error(`Row ${row} is not visible.`);
  let start = 0;
  for (const child of Array.from(rowElement.children) as HTMLElement[]) {
    const length = child.textContent?.length ?? 0;
    if (col < start + length) return child;
    start += length;
  }
  throw new Error(`No element at ${row}:${col}.`);
}

function copySelection(terminal: Terminal): string | undefined {
  let copied: string | undefined;
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { setData(type: string, value: string) { if (type === "text/plain") copied = value; } },
  });
  terminal.element?.querySelector("textarea")?.dispatchEvent(event);
  return copied;
}

function equal<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function check(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}

type Scenario = () => Promise<string>;

const scenarios: Record<string, Scenario> = {
  "Pi's sample fills the browser buffer as Pi lays it out at 60, then 36 columns": async () => {
    const f = await open(60, 30);
    try {
      f.context.append("answer", samples.wrap.lines, "sealed");
      await f.host.drain();
      equal(rows(f.terminal), samples.wrap.layouts["60"], "60 columns");
      f.terminal.resize(36, 30);
      await f.host.drain();
      equal(rows(f.terminal), samples.wrap.layouts["36"], "36 columns");
      return "every row equals Pi's own render at both widths";
    } finally { f.dispose(); }
  },
  "The DOM renderer paints bold on a wrapped row and the quote marker's color on continuation rows": async () => {
    const f = await open(36, 30);
    try {
      f.context.append("answer", samples.wrap.lines, "sealed");
      await f.host.drain();
      await painted();
      const all = rows(f.terminal);
      const bold = all.indexOf("phrase that keeps going and inline");
      check(cell(f.terminal, bold, 0).classList.contains("xterm-bold"), "bold continues on the wrapped row");
      check(!cell(f.terminal, bold, 24).classList.contains("xterm-bold"), "the prose after the phrase is not bold");
      const quote = all.findIndex(row => row.startsWith("│ enough to wrap"));
      equal(getComputedStyle(cell(f.terminal, quote, 0)).color, "rgb(128, 128, 128)", "continuation marker color");
      return "xterm-bold on the wrapped bold row; the repeated │ painted rgb(128, 128, 128)";
    } finally { f.dispose(); }
  },
  "Copy of a selection across soft-wrapped rows yields logical text without prefixes": async () => {
    const f = await open(36, 30);
    try {
      f.context.append("answer", samples.wrap.lines, "sealed");
      await f.host.drain();
      const all = rows(f.terminal);
      const quote = all.findIndex(row => row.startsWith("│ A quoted"));
      f.terminal.select(0, quote, 36 * 3);
      check(f.terminal.getSelection().includes("│ enough"), "xterm's own selection text shows the repeated marker");
      equal(copySelection(f.terminal), "│ A quoted paragraph that is long enough to wrap, so every quoted row needs its prefix.", "quote copy");
      const bullet = all.indexOf("  enough to wrap onto a continuation");
      f.terminal.select(0, bullet, 36 + 6);
      equal(copySelection(f.terminal), "enough to wrap onto a continuation line", "a selection starting in a prefix");
      return "a three-row quote copied as one logical line; a selection starting in a hanging indent copied no indent";
    } finally { f.dispose(); }
  },
  "Search selects a match that crosses a soft break, and copying it yields the term": async () => {
    const f = await open(36, 10);
    try {
      f.context.append("answer", samples.wrap.lines, "sealed");
      await f.host.drain();
      check(selectMatch(f.terminal, f.host, "continuation line at sixty"), "match found");
      const position = f.terminal.getSelectionPosition()!;
      equal(position.end.y - position.start.y, 1, "the selection spans two rows");
      equal(copySelection(f.terminal), "continuation line at sixty", "copied match");
      check(!selectMatch(f.terminal, f.host, "│ enough"), "a continuation marker is not searchable");
      return "the match selection spanned the soft break and copied as the logical term";
    } finally { f.dispose(); }
  },
  "Chinese and nested-list content renders as Pi lays it out, and Chinese copy and search use the logical text": async () => {
    const f = await open(60, 30);
    try {
      f.context.append("answer", samples.cjk.lines, "sealed");
      await f.host.drain();
      equal(rows(f.terminal), samples.cjk.layouts["60"], "60 columns");
      f.terminal.resize(36, 30);
      await f.host.drain();
      const all = rows(f.terminal);
      equal(all, samples.cjk.layouts["36"], "36 columns");
      const quote = all.findIndex(row => row.startsWith("│ 引用"));
      f.terminal.select(0, quote, 36 * 2);
      equal(copySelection(f.terminal), "│ 引用里的中文也要在每一行保留引用标记，宽度变化时不能丢。", "Chinese quote copy");
      check(selectMatch(f.terminal, f.host, "标记"), "Chinese match found");
      equal(copySelection(f.terminal), "标记", "a Chinese match split across a soft break");
      return "rows equal Pi's at 60 and 36; the Chinese quote and a split match copied as logical text";
    } finally { f.dispose(); }
  },
  "A history reader keeps the same Block text at the top of the viewport across browser resizes": async () => {
    const f = await open(40, 6);
    try {
      const paragraph = (word: string): LinesTextLine[] => [{ spans: [{ text: `${word} `.repeat(30).trim() }] }];
      f.context.append("a", paragraph("alpha"), "sealed");
      f.context.append("b", paragraph("bravo"), "sealed");
      f.context.append("c", paragraph("charlie"), "sealed");
      await f.host.drain();
      f.terminal.scrollToLine(f.host.range("context-1", "b")!.start + 1);
      for (const cols of [20, 60, 40]) {
        f.terminal.resize(cols, 6);
        await f.host.drain();
        const buffer = f.terminal.buffer.active;
        check((buffer.getLine(buffer.viewportY)?.translateToString(true) ?? "").startsWith("bravo"), `${cols}: top row shows Block b`);
      }
      return "the top row stayed in Block b at 20, 60, and 40 columns";
    } finally { f.dispose(); }
  },
};

const summary = document.getElementById("summary")!;
const results = document.getElementById("results")!;
let passed = 0;
try {
  for (const [name, run] of Object.entries(scenarios)) {
    const detail = await run();
    const item = document.createElement("li");
    item.textContent = `${name}: ${detail}`;
    results.appendChild(item);
    passed++;
  }
  summary.textContent = `${passed} text/lines browser scenarios passed.`;
  summary.dataset.status = "passed";
} catch (error) {
  summary.textContent = `Scenario ${passed + 1} failed: ${error instanceof Error ? error.message : String(error)}`;
  summary.dataset.status = "failed";
}

// Manual check: a demo terminal for a real mouse selection.
const demo = await open(36, 14, document.getElementById("demo")!);
demo.context.append("answer", samples.wrap.lines, "sealed");
await demo.host.drain();
demo.terminal.scrollToLine(rows(demo.terminal).findIndex(row => row.startsWith("- A bullet")) - 1);
document.getElementById("copy")!.onclick = () => {
  document.getElementById("copied")!.textContent = copySelection(demo.terminal) ?? "(no managed selection)";
};
