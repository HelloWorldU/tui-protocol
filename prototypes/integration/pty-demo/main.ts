import { Terminal } from "@xterm/xterm";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import "@xterm/xterm/css/xterm.css";
import { ProtocolStreamDecoder } from "../../reference-codec/index.ts";
import { BrowserSearchHistory } from "../xterm-browser-search/search-history.ts";
import { XtermProtocolEndpoint, XtermMixedStreamIngress } from "../xterm-protocol-endpoint/index.ts";
import { copySelection } from "../xterm-browser-protocol-endpoint/scenario-harness.ts";
import "./style.css";

const status = document.querySelector<HTMLElement>("#status")!;
const report = document.querySelector<HTMLElement>("#report")!;
const terminal = new Terminal({ cols: 40, rows: 8, scrollback: 1000 });
terminal.open(document.querySelector<HTMLElement>("#terminal")!);
const history = new BrowserSearchHistory(terminal);
const endpoint = new XtermProtocolEndpoint(terminal as unknown as HeadlessTerminal, { completeBaselineSupported: true, history });
const token = document.querySelector<HTMLMetaElement>('meta[name="pty-token"]')!.content;
const socket = new WebSocket(`ws://${location.host}/pty?token=${token}`);
socket.binaryType = "arraybuffer";
const encoder = new TextEncoder();
const observer = new ProtocolStreamDecoder();
let context = "";
let operation = 0;
let errorReturned = false;
let exitCode: number | undefined;
let failed: Error | undefined;
let processing = Promise.resolve();
const diagnostics: string[] = [];
function send(data: Uint8Array): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(data as Uint8Array<ArrayBuffer>);
}
const ingress = new XtermMixedStreamIngress(terminal as unknown as HeadlessTerminal, endpoint, {
  onResponseFrame: send,
  onDiagnostic: diagnostic => diagnostics.push(diagnostic.reason),
});
terminal.onData(data => send(encoder.encode(data)));
socket.onmessage = event => {
  processing = processing.then(async () => {
    if (typeof event.data === "string") { exitCode = JSON.parse(event.data).code; return; }
    const bytes = new Uint8Array(event.data as ArrayBuffer);
    await ingress.push(bytes);
    // Read-only observation after rendering; this is not a new wire acknowledgement.
    for (const decoded of observer.push(bytes)) {
      if (decoded.type !== "message") continue;
      const message = decoded.message;
      if ("operation_id" in message) {
        operation = Number(message.operation_id);
        if ("context_id" in message) context = message.context_id;
      }
      if (message.kind === "capability.query" && operation === 10) errorReturned = true;
    }
    if (diagnostics.length) throw new Error(diagnostics.join("; "));
    status.textContent = context ? `Connected — last Operation ${operation}; Context ${endpoint.context(context)?.state}` : "Negotiating through PTY…";
  }).catch(error => { failed = error; status.textContent = `Failed: ${String(error)}`; });
};
socket.onerror = () => { failed = new Error("Host connection failed"); status.textContent = failed.message; };
socket.onclose = () => {
  processing = processing.then(async () => {
    await ingress.finish();
    if (diagnostics.length) throw new Error(diagnostics.join("; "));
    status.textContent = `Child exited: ${exitCode ?? "connection closed"}`;
  }).catch(error => { failed = error; status.textContent = `Failed: ${String(error)}`; });
};
function resize(cols: number): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  history.resize(cols, 8);
  socket.send(JSON.stringify({ type: "resize", cols, rows: 8 }));
}
document.querySelector<HTMLButtonElement>("#next")!.onclick = () => send(encoder.encode("n"));
document.querySelector<HTMLButtonElement>("#quit")!.onclick = () => send(encoder.encode("q"));
document.querySelector<HTMLButtonElement>("#resize")!.onclick = () => resize(terminal.cols === 40 ? 10 : 40);
document.querySelector<HTMLButtonElement>("#search")!.onclick = () => {
  history.findNext(document.querySelector<HTMLInputElement>("#query")!.value);
};
function assert(value: boolean, label: string): void { if (!value) throw new Error(label); }
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (failed) throw failed;
    if (Date.now() > deadline) throw new Error("Timed out waiting for producer stage");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await processing;
  if (failed) throw failed;
}
document.querySelector<HTMLButtonElement>("#verify")!.onclick = async event => {
  (event.currentTarget as HTMLButtonElement).disabled = true;
  for (const button of document.querySelectorAll<HTMLButtonElement>("button")) button.disabled = true;
  terminal.options.disableStdin = true;
  try {
    await waitFor(() => operation === 3);
    const result = () => endpoint.range(context, "result")!;
    const content = () => endpoint.context(context)?.blocks.find(block => block.id === "thinking");
    terminal.scrollToLine(result().start);
    terminal.select(0, result().start, 4);
    assert(copySelection(terminal) === "结果", "initial result copy");
    const checkReading = () => {
      assert(terminal.buffer.active.viewportY === result().start, "reader stays at viewport top");
      assert(copySelection(terminal) === "结果", "retained selection copies the same Chinese text");
    };
    send(encoder.encode("n")); await waitFor(() => operation === 6); checkReading();
    assert(content()?.content.data === "思考\t开始\n分析输入\n核对条件\n形成结论", "streamed content snapshot");
    send(encoder.encode("n")); await waitFor(() => operation === 7); checkReading();
    assert(content()?.content.data === "思考\t完成", "replaced suffix snapshot");
    resize(10); await new Promise(resolve => setTimeout(resolve, 300)); await processing; checkReading();
    assert(result().lineCount > 1, "narrow resize actually reflows result Block");
    assert(endpoint.context(context)?.state === "open", "real PTY resize keeps Context open");
    resize(40); await new Promise(resolve => setTimeout(resolve, 300)); await processing; checkReading();
    send(encoder.encode("n")); await waitFor(() => operation === 8); checkReading();
    assert(history.findNext("保留"), "retained result remains searchable");
    send(encoder.encode("n")); await waitFor(() => errorReturned);
    assert(content()?.lifecycle === "sealed", "thinking sealed");
    assert(content()?.content.data === "思考\t最终结论", "rejected Update changes nothing");
    assert(copySelection(terminal) === "保留", "Seal and rejected Update preserve current search match");
    send(encoder.encode("q")); await waitFor(() => exitCode !== undefined);
    assert(exitCode === 0, "producer exits cleanly after Context close response");
    assert(endpoint.context(context)?.state === "closed", "Context closed");
    report.textContent = "PASS: real PTY negotiation, Append, streaming Extend, ReplaceSuffix, Update, Seal, returned rejection, reading/copy/search, resize round trip, and clean child exit.";
  } catch (error) { report.textContent = `FAIL: ${String(error)}`; socket.close(); }
};
window.addEventListener("beforeunload", () => { socket.close(); ingress.dispose(); endpoint.dispose(); terminal.dispose(); });
