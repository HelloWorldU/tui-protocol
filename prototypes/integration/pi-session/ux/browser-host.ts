import { Terminal } from "@xterm/xterm";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import { SearchAddon } from "@xterm/addon-search";
import { BrowserSearchHistory } from "../../xterm-browser-search/search-history.ts";
import { XtermMixedStreamIngress, XtermProtocolEndpoint } from "../../xterm-protocol-endpoint/index.ts";
import type { TrialEvent } from "../event-adapter.ts";

export type Mode = "regular" | "protocol";
export const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export function assert(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
type Control = { type: "ready"; mode: Mode } | { type: "complete"; trace: TrialEvent[]; requests: number }
  | { type: "resized"; cols: number } | { type: "exit"; code: number | null; reason?: string };

export class ComparisonHost {
  readonly terminal: Terminal;
  readonly mode: Mode;
  readonly events: TrialEvent[] = [];
  readonly controls: Control[] = [];
  readonly search: SearchAddon | BrowserSearchHistory;
  #history?: BrowserSearchHistory;
  #endpoint?: XtermProtocolEndpoint;
  #ingress?: XtermMixedStreamIngress;
  #socket: WebSocket;
  #pending = Promise.resolve();
  #failure?: unknown;
  #closed = false;
  constructor(mode: Mode, element: HTMLElement) {
    this.mode = mode;
    this.terminal = new Terminal({ cols: 60, rows: 12, scrollback: 2000, disableStdin: true });
    element.replaceChildren(); this.terminal.open(element);
    const token = document.querySelector<HTMLMetaElement>('meta[name="ux-token"]')!.content;
    this.#socket = new WebSocket(`ws://${location.host}/comparison?mode=${mode}&token=${token}`);
    if (mode === "protocol") {
      this.#history = new BrowserSearchHistory(this.terminal);
      this.search = this.#history;
      this.#endpoint = new XtermProtocolEndpoint(this.terminal as unknown as HeadlessTerminal, { completeBaselineSupported: true, history: this.#history });
      this.#ingress = new XtermMixedStreamIngress(this.terminal as unknown as HeadlessTerminal, this.#endpoint, {
        pendingInputLimits: { bytes: 2 * 1024 * 1024, pushes: 512 },
        onResponseFrame: frame => this.send({ type: "reply", data: new TextDecoder().decode(frame) }),
        onDiagnostic: diagnostic => { throw new Error(diagnostic.reason); },
      });
    } else { this.search = new SearchAddon(); this.terminal.loadAddon(this.search); }
    this.#socket.onmessage = event => {
      this.#pending = this.#pending.then(async () => {
        const message = JSON.parse(event.data);
        if (message.type === "failure") throw new Error(message.reason);
        if (message.type === "exit" && message.code !== 0) throw new Error(`Worker exited ${message.code}: ${message.reason ?? ""}`);
        if (message.type === "bytes") {
          if (this.#ingress) await this.#ingress.push(new TextEncoder().encode(message.data));
          else await new Promise<void>(resolve => this.terminal.write(message.data, resolve));
        } else if (message.type === "event") this.events.push(message.event);
        else this.controls.push(message);
      }).catch(error => { this.#failure ??= error; });
    };
    this.#socket.onerror = () => { this.#failure ??= new Error("Comparison connection failed"); };
    this.#socket.onclose = () => { this.#closed = true; };
  }
  send(message: object) { assert(this.#socket.readyState === WebSocket.OPEN, "Comparison socket is not open"); this.#socket.send(JSON.stringify(message)); }
  async until(predicate: () => boolean, description: string) {
    const start = Date.now();
    while (!predicate()) {
      if (this.#failure) throw this.#failure;
      if (Date.now() - start > 20_000) throw new Error(`Timed out: ${description}; rows: ${this.text().slice(-2500)}`);
      await pause(25); await this.#pending;
    }
    await this.settle();
  }
  async settle() { await pause(180); await this.#pending; if (this.#failure) throw this.#failure; }
  text() { return this.rows().join("\n"); }
  rows() {
    const buffer = this.terminal.buffer.normal;
    return Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? "");
  }
  matches(marker: string) {
    assert(marker.length > 0, "A fixture marker must not be empty");
    return this.rows().flatMap((line, row) => {
      const matches: { row: number; column: number; line: string }[] = [];
      for (let column = line.indexOf(marker); column >= 0; column = line.indexOf(marker, column + marker.length)) matches.push({ row, column, line });
      return matches;
    });
  }
  readAndSelect(marker: string) {
    const matches = this.matches(marker);
    assert(matches.length === 1, `Expected one ${marker}, got ${matches.length}`);
    const { row, column } = matches[0];
    this.terminal.scrollToLine(Math.max(0, row - 2));
    this.terminal.select(column, row, marker.length);
    assert(this.terminal.getSelection() === marker, `Initial selection mismatch for ${marker}`);
    assert(this.terminal.buffer.normal.viewportY < this.terminal.buffer.normal.baseY, "Scenario must start above bottom");
    return this.observe(marker);
  }
  observe(marker: string) {
    const match = this.matches(marker);
    const buffer = this.terminal.buffer.normal;
    const screenRow = match.length === 1 ? match[0].row - buffer.viewportY : null;
    return { marker, occurrences: match.length, screenRow, visible: screenRow !== null && screenRow >= 0 && screenRow < this.terminal.rows,
      viewport: buffer.viewportY, base: buffer.baseY, selected: this.terminal.getSelection(), copied: this.copy() };
  }
  copy(): string | undefined {
    let copied: string | undefined;
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData(format: string, value: string) { if (format === "text/plain") copied = value; } } });
    this.terminal.element!.dispatchEvent(event);
    return copied;
  }
  async resize(cols: number) {
    if (this.#history) this.#history.resize(cols, this.terminal.rows);
    else this.terminal.resize(cols, this.terminal.rows);
    this.send({ type: "resize", cols });
    await this.until(() => this.controls.some(c => c.type === "resized" && c.cols === cols), `resize ${cols}`);
  }
  closedContexts() {
    const contexts = this.#endpoint?.contexts();
    return contexts ? contexts.length === 1 && contexts[0].state === "closed" : null;
  }
  async dispose() {
    if (this.#socket.readyState === WebSocket.OPEN) {
      this.send({ type: "stop" });
      const until = Date.now() + 5000;
      while (!this.#closed && Date.now() < until) await pause(25);
      this.#socket.close();
    }
    await this.#pending;
    this.#ingress?.dispose(); this.#endpoint?.dispose(); this.terminal.dispose();
    if (this.#failure) throw this.#failure;
    assert(this.controls.some(c => c.type === "exit" && c.code === 0), "Worker exit and temporary-directory cleanup were not confirmed");
  }
}
