import { Terminal } from "@xterm/xterm";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { ProtocolStreamDecoder } from "../../../protocol/src/index.ts";
import { BrowserSearchHistory } from "../xterm-browser-search/search-history.ts";
import { XtermMixedStreamIngress, XtermProtocolEndpoint } from "../xterm-protocol-endpoint/index.ts";

const status = document.querySelector<HTMLElement>("#status")!;
const report = document.querySelector<HTMLElement>("#report")!;
const container = document.querySelector<HTMLElement>("#terminal")!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
const token = document.querySelector<HTMLMetaElement>('meta[name="pty-token"]')!.content;
let cleanup = () => {};
function assert(value: boolean, reason: string): void { if (!value) throw new Error(reason); }

function run(mode: string): void {
  cleanup();
  container.replaceChildren();
  buttons.forEach(button => { button.disabled = true; });
  report.textContent = "";
  status.textContent = `Running ${mode} host…`;
  const terminal = new Terminal({ cols: 40, rows: 8, scrollback: 1000 });
  terminal.open(container);
  const history = new BrowserSearchHistory(terminal);
  const endpoint = new XtermProtocolEndpoint(terminal as unknown as HeadlessTerminal,
    { completeBaselineSupported: mode === "supported", history });
  const socket = new WebSocket(`ws://${location.host}/pty?token=${token}`);
  socket.binaryType = "arraybuffer";
  let processing = Promise.resolve();
  let exitCode: number | undefined;
  let failed: unknown;
  let contexts = 0;
  let queries = 0;
  const operations: string[] = [];
  let ordinary = "";
  const observer = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  const ingress = new XtermMixedStreamIngress(terminal as unknown as HeadlessTerminal, endpoint, {
    onResponseFrame(frame) {
      if (mode !== "silent" && socket.readyState === WebSocket.OPEN) socket.send(frame as Uint8Array<ArrayBuffer>);
    },
    onDiagnostic(diagnostic) { failed = new Error(diagnostic.reason); },
  });
  terminal.onData(data => { if (socket.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data)); });
  const deadline = setTimeout(() => { failed = new Error("Host check timed out"); socket.close(); }, 12_000);
  socket.onmessage = event => {
    processing = processing.then(async () => {
      if (typeof event.data === "string") { exitCode = JSON.parse(event.data).code; return; }
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      await ingress.push(bytes);
      for (const decoded of observer.push(bytes)) {
        if (decoded.type === "error") throw new Error(decoded.reason);
        if (decoded.type === "ordinary") { ordinary += new TextDecoder().decode(decoded.data); continue; }
        const message = decoded.message;
        if (message.kind === "capability.query") queries++;
        if (message.kind === "context.open") contexts++;
        if (message.kind.startsWith("block.")) operations.push(message.kind);
      }
    }).catch(error => { failed = error; socket.close(); });
  };
  socket.onerror = () => { failed = new Error("Host connection failed"); };
  socket.onclose = () => {
    clearTimeout(deadline);
    processing = processing.then(async () => {
      await ingress.finish();
      if (failed) throw failed;
      assert(exitCode === 0, `child exit was ${exitCode}`);
      assert(queries === 1, "exactly one negotiation query");
      if (mode === "supported") {
        assert(contexts === 1, "one Context opened");
        assert(operations.join(",") === "block.append,block.extend,block.extend,block.extend,block.update,block.seal,block.append", "expected streaming Operations");
        const context = endpoint.contexts()[0];
        assert(context?.state === "closed", "Context closed after response");
        assert(context.blocks[0]?.content.data === "Thinking complete" && context.blocks[0].lifecycle === "sealed", "thinking completed and sealed");
        assert(context.blocks[1]?.content.data === "Result: the example completed.", "answer content");
        assert(history.findNext("Result:"), "answer is rendered and searchable");
        assert(!ordinary.includes("[fallback]"), "supported path did not fall back");
      } else {
        assert(contexts === 0 && operations.length === 0, "fallback sends no Context or Block Messages");
        assert(ordinary.includes("[fallback] Thinking") && ordinary.includes("Result: the example completed."), "readable fallback output");
      }
      report.textContent = `PASS: ${mode}; child exited 0; ${contexts} Context open requests; ${operations.length} Block Operations. ` +
        (mode === "supported" ? "Streaming content completed, sealed, and rendered." : "Application-owned readable fallback completed.");
      status.textContent = "Finished. Choose another mode to run a new process.";
    }).catch(error => { report.textContent = `FAIL: ${String(error)}`; })
      .finally(() => buttons.forEach(button => { button.disabled = false; }));
  };
  cleanup = () => { clearTimeout(deadline); socket.close(); ingress.dispose(); endpoint.dispose(); terminal.dispose(); };
}
buttons.forEach(button => { button.onclick = () => run(button.id); });
window.addEventListener("beforeunload", () => cleanup());
