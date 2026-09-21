import { Terminal } from "@xterm/xterm";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { trialSessionLimits, PendingInputBudget } from "@tui-protocol/terminal";
import { BrowserSearchHistory } from "../../prototypes/integration/xterm-browser-search/search-history.ts";
import { XtermMixedStreamIngress, XtermProtocolEndpoint } from "../../prototypes/integration/xterm-protocol-endpoint/index.ts";

const status = document.querySelector<HTMLElement>("#status")!;
const report = document.querySelector<HTMLElement>("#report")!;
const connect = document.querySelector<HTMLButtonElement>("#connect")!;
const disconnect = document.querySelector<HTMLButtonElement>("#disconnect")!;
// Optional application controls for the multi-round example, not protocol APIs.
const commands = [
  [document.querySelector<HTMLButtonElement>("#next"), "n"],
  [document.querySelector<HTMLButtonElement>("#quit"), "q"],
] as const;
for (const [button, command] of commands) {
  if (button) button.onclick = () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(command));
  };
}
// Exposed to local experiment checks, not a stable renderer API.
export const terminal = new Terminal({ cols: 40, rows: 8, scrollback: 1000 });
terminal.open(document.querySelector<HTMLElement>("#terminal")!);

// This is the pinned browser renderer, not a portable terminal implementation.
export const history = new BrowserSearchHistory(terminal);
const endpoint = new XtermProtocolEndpoint(terminal as unknown as HeadlessTerminal, {
  completeBaselineSupported: true, // Experimental fixture assertion, not feature detection.
  history,
  resourceLimits: trialSessionLimits,
});
let socket: WebSocket | undefined;
let pending = Promise.resolve();
const pendingBudget = new PendingInputBudget(2 * 1024 * 1024, 512);
let exitCode: number | undefined;
let failure: unknown;
let leaving = false;
let deadline: ReturnType<typeof setTimeout> | undefined;
const diagnostics: string[] = [];
const ingress = new XtermMixedStreamIngress(terminal as unknown as HeadlessTerminal, endpoint, {
  pendingInputLimits: { bytes: 2 * 1024 * 1024, pushes: 512 },
  // Protocol replies return to the application's stdin, never terminal.write().
  onResponseFrame(frame) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(frame as Uint8Array<ArrayBuffer>);
    else diagnostics.push("Response could not be delivered: transport closed.");
  },
  onDiagnostic(diagnostic) { diagnostics.push(diagnostic.reason); },
});
const input = terminal.onData(data => {
  if (document.body.dataset.inputMode !== "form") sendApplicationInput(data);
});

/** Host-local form transport; not a terminal protocol API. False means nothing was sent. */
export function sendApplicationInput(data: string): boolean {
  if (socket?.readyState !== WebSocket.OPEN || failure || leaving) return false;
  socket.send(new TextEncoder().encode(data));
  return true;
}

export async function settleHost(): Promise<void> {
  await pending;
  if (failure) throw failure;
}

function showState(): void {
  const rendered = document.querySelector<HTMLElement>("#rendered");
  if (rendered) {
    const buffer = terminal.buffer.normal;
    rendered.textContent = Array.from({ length: buffer.length }, (_, row) =>
      buffer.getLine(row)?.translateToString(true) ?? "").join("\n");
  }
  report.textContent = endpoint.contexts().map(context =>
    `Context ${context.id}: ${context.state}\n` + context.blocks.map(block =>
      `  ${block.id}: ${block.lifecycle}; ${JSON.stringify(block.content.data)}`).join("\n"),
  ).concat(diagnostics).join("\n") || "No Contexts or local diagnostics.";
}

connect.onclick = () => {
  connect.disabled = true;
  disconnect.disabled = false;
  status.textContent = "Connecting…";
  const token = document.querySelector<HTMLMetaElement>('meta[name="pty-token"]')!.content;
  socket = new WebSocket(`ws://${location.host}/pty?token=${token}`);
  socket.binaryType = "arraybuffer";
  socket.onopen = () => {
    status.textContent = "Connected; receiving application output.";
    for (const [button] of commands) if (button) button.disabled = false;
  };
  deadline = setTimeout(() => {
    failure = new Error("Example deadline exceeded");
    socket?.close();
  }, Number(document.body.dataset.deadlineMs ?? 12_000));
  socket.onmessage = event => {
    if (failure || leaving) return;
    let release: () => void;
    try { release = pendingBudget.acquire(typeof event.data === "string" ? event.data.length * 2 : event.data.byteLength); }
    catch (error) { failure = error; endpoint.abort(error); socket?.close(); return; }
    // Serialize host controls with rendered input, not just decoded Messages.
    pending = pending.then(async () => {
      if (leaving || failure) return;
      if (typeof event.data === "string") {
        const control = JSON.parse(event.data);
        if (control.type !== "exit" || !Number.isInteger(control.code)) throw new Error("Invalid host exit control");
        exitCode = control.code;
        diagnostics.push(`Context states before EOF: ${endpoint.contexts().map(context => context.state).join(", ") || "none"}`);
      } else {
        // All incoming terminal bytes go through this path exactly once.
        await ingress.push(new Uint8Array(event.data as ArrayBuffer));
      }
      showState();
    }).catch(error => { failure = error; endpoint.abort(error); socket?.close(); }).finally(release);
  };
  socket.onerror = () => { failure = new Error("Transport failed"); };
  socket.onclose = () => {
    clearTimeout(deadline);
    disconnect.disabled = true;
    for (const [button] of commands) if (button) button.disabled = true;
    pending = pending.then(async () => {
      if (leaving) return;
      if (failure) throw failure;
      // Settle queued writes before ending the Session. Keep rendered history.
      await ingress.finish();
      showState();
      status.textContent = exitCode === undefined ? "Disconnected; no child exit confirmation." : `Child exited: ${exitCode}`;
    }).catch(error => {
      status.textContent = `Stopped: ${String(error)}. Reload to start a fresh connection.`;
    });
  };
};
disconnect.onclick = () => socket?.close();
document.querySelector<HTMLButtonElement>("#search")!.onclick = () => {
  const term = document.querySelector<HTMLInputElement>("#query")!.value;
  const found = term.length > 0 && history.findNext(term);
  document.querySelector<HTMLElement>("#search-result")!.textContent = found ? `Found: ${terminal.getSelection()}` : "No match";
};
window.addEventListener("beforeunload", () => {
  leaving = true;
  clearTimeout(deadline);
  socket?.close();
  // Do not dispose renderer state while an accepted write is still pending.
  void pending.finally(() => { input.dispose(); ingress.dispose(); endpoint.dispose(); terminal.dispose(); });
});
