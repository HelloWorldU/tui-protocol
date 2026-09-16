import { Terminal } from "@xterm/xterm";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import "@xterm/xterm/css/xterm.css";
import type { Operation } from "../../block-model/model.ts";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";
import { XtermProtocolEndpoint, XtermMixedStreamIngress } from "../xterm-protocol-endpoint/index.ts";

const run = document.querySelector<HTMLButtonElement>("#run")!;
const result = document.querySelector<HTMLElement>("#result")!;
function assert(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }

run.onclick = () => {
  run.disabled = true;
  result.textContent = "Running…";
  const terminal = new Terminal({ cols: 40, rows: 8, scrollback: 1000 });
  terminal.open(document.querySelector<HTMLElement>("#terminal")!);
  const token = document.querySelector<HTMLMetaElement>('meta[name="pty-token"]')!.content;
  const socket = new WebSocket(`ws://${location.host}/pty?token=${token}`);
  socket.binaryType = "arraybuffer";
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  let released = false;
  let sawPause = false;
  let renderedUpdates = 0;
  let heldBytes = 0;
  let pendingBytes = 0;
  let peakPendingBytes = 0;
  let consumed = 0;
  let pending = Promise.resolve();
  let failure: unknown;
  let exitCode: number | undefined;
  let flow: { peak: number; outstanding: number; pauses: number; resumes: number; peakSocketBytes: number } | undefined;
  function unblock() {
    if (!released && entered && sawPause) { released = true; heldBytes = pendingBytes; release(); }
  }
  class GatedHistory extends PrivateCoreBlockHistory {
    override async renderAccepted(operation: Operation) {
      if (operation.type === "update") {
        assert(operation.content === `value-${String(renderedUpdates + 1).padStart(4, "0")}\n${"x".repeat(2048)}`, "Updates rendered out of order");
      }
      if (operation.type === "update" && renderedUpdates === 0) {
        entered = true; unblock(); await barrier;
      }
      await super.renderAccepted(operation);
      if (operation.type === "update") renderedUpdates++;
    }
  }
  const headless = terminal as unknown as HeadlessTerminal;
  const endpoint = new XtermProtocolEndpoint(headless, {
    completeBaselineSupported: true, history: new GatedHistory(headless),
  });
  const ingress = new XtermMixedStreamIngress(headless, endpoint, {
    onResponseFrame(frame) { socket.send(frame as Uint8Array<ArrayBuffer>); },
    onDiagnostic(value) { throw new Error(value.reason); },
  });
  const stop = (error: unknown) => {
    failure ??= error;
    endpoint.abort(error); release(); socket.close();
  };
  const deadline = setTimeout(() => stop(new Error("Pressure check exceeded 30 seconds")), 30_000);
  socket.onmessage = event => {
    if (failure) return;
    if (typeof event.data === "string") {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "flow") {
          flow = message;
          if (message.paused) { sawPause = true; unblock(); }
        } else if (message.type === "exit") exitCode = message.code;
        else throw new Error("Unexpected host control");
      } catch (error) { stop(error); }
      return;
    }
    const bytes = new Uint8Array(event.data as ArrayBuffer);
    pendingBytes += bytes.length;
    peakPendingBytes = Math.max(peakPendingBytes, pendingBytes);
    // Preserve arrival order, including work waiting outside ingress itself.
    pending = pending.then(async () => {
      if (failure) return;
      await ingress.push(bytes);
      consumed += bytes.length; pendingBytes -= bytes.length;
      socket.send(JSON.stringify({ type: "consumed", total: consumed }));
    }).catch(stop);
  };
  socket.onerror = () => stop(new Error("WebSocket failed"));
  socket.onclose = () => {
    clearTimeout(deadline); release();
    void pending.then(async () => {
      if (failure) throw failure;
      assert(endpoint.contexts()[0]?.state === "closed", "Context was not closed before EOF cleanup");
      await ingress.finish();
      assert(exitCode === 0, "No successful child exit");
      assert(entered && sawPause && heldBytes > 0, "Render stall did not overlap outstanding host input");
      assert(flow && flow.pauses > 0 && flow.resumes > 0 && flow.outstanding === 0, "Host did not pause, resume, and drain");
      assert(pendingBytes === 0 && renderedUpdates === 256, "Missing rendered Updates or unsettled input");
      const [context] = endpoint.contexts();
      assert(context?.state === "closed" && context.blocks[0]?.lifecycle === "sealed", "Context did not close normally");
      const expected = `value-0256\n${"x".repeat(2048)}`;
      assert(context.blocks[0]?.content.data === expected, "Incorrect Session content");
      const range = endpoint.range(context.id, "pressure"); assert(range, "Missing rendered range");
      const buffer = terminal.buffer.normal;
      const rows = Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? "");
      assert(rows.slice(range.start, range.start + range.lineCount).join("") === expected.replace("\n", ""), "Incorrect rendered content");
      const match = rows.join("").match(/PRODUCER:(\{[^}]+\})/);
      assert(match, "No producer drain report");
      const producer = JSON.parse(match[1]!);
      result.textContent = "PASS: 256 Updates rendered, host paused/resumed, all credited bytes drained, and Context closed.\n" +
        JSON.stringify({ ...flow, peakPendingBytes, heldBytes, producer }, null, 2);
    }).catch(error => { result.textContent = `FAIL: ${String(error)}`; }).finally(() => {
      ingress.dispose(); endpoint.dispose();
      // Leave the completed native display visible; reload for another run.
    });
  };
  window.addEventListener("beforeunload", () => {
    clearTimeout(deadline); stop(new Error("Page closed"));
    void pending.finally(() => { ingress.dispose(); endpoint.dispose(); terminal.dispose(); });
  }, { once: true });
};
