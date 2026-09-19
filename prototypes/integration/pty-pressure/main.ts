import { Terminal } from "@xterm/xterm";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import "@xterm/xterm/css/xterm.css";
import type { Operation } from "../../block-model/model.ts";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";
import { XtermProtocolEndpoint, XtermMixedStreamIngress } from "../xterm-protocol-endpoint/index.ts";
import type { Workload } from "./workload.ts";
import { readProducerReport, intervalOverlap } from "./report.ts";

declare const __WORKLOAD__: Workload;
const workload = __WORKLOAD__;

const run = document.querySelector<HTMLButtonElement>("#run")!;
const result = document.querySelector<HTMLElement>("#result")!;
document.querySelector<HTMLElement>("#workload")!.textContent =
  `${workload.updates} Updates, ${workload.padding} padding characters each; ${workload.holdMs === null ? "permanent" : `${workload.holdMs} ms`} controlled hold after a host pause.`;
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
  let holdStartedAt = 0;
  let holdEndedAt = 0;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let renderedUpdates = 0;
  let heldBytes = 0;
  let pendingBytes = 0;
  let peakPendingBytes = 0;
  let consumed = 0;
  let received = 0;
  let pending = Promise.resolve();
  let failure: unknown;
  let hostFailure: { reason: string; childExitObserved: boolean } | undefined;
  let exitCode: number | undefined;
  let flow: { peak: number; outstanding: number; pauses: number; resumes: number; peakSocketBytes: number } | undefined;
  function unblock() {
    if (!released && entered && sawPause) {
      released = true; heldBytes = pendingBytes; holdStartedAt = Date.now();
      if (workload.holdMs !== null) holdTimer = setTimeout(() => { holdEndedAt = Date.now(); release(); }, workload.holdMs);
    }
  }
  class GatedHistory extends PrivateCoreBlockHistory {
    override async renderAccepted(operation: Operation) {
      if (operation.type === "update") {
        assert(operation.content === `value-${String(renderedUpdates + 1).padStart(4, "0")}\n${"x".repeat(workload.padding)}`, "Updates rendered out of order");
      }
      if (operation.type === "update" && renderedUpdates === 0) {
        entered = true; unblock(); await barrier;
        if (hostFailure || failure) throw new Error("Stopped before rendering held Update");
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
    clearTimeout(holdTimer);
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
        } else if (message.type === "host_error") {
          assert(message.reason === "consumer_stalled" && typeof message.childExitObserved === "boolean", "Invalid host failure report");
          hostFailure = message;
          endpoint.abort(new Error("Consumer stalled")); release();
        } else if (message.type === "exit") exitCode = message.code;
        else throw new Error("Unexpected host control");
      } catch (error) { stop(error); }
      return;
    }
    const bytes = new Uint8Array(event.data as ArrayBuffer);
    received += bytes.length;
    if (received > 8 * 1024 * 1024) { stop(new Error("Pressure fixture exceeded 8 MiB")); return; }
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
  socket.onclose = event => {
    if (!hostFailure && (event.code !== 1000 || exitCode !== 0)) {
      failure ??= new Error("Transport closed before successful child completion");
      endpoint.abort(failure);
    }
    clearTimeout(deadline); clearTimeout(holdTimer); release();
    void pending.then(async () => {
      if (workload.holdMs === null) {
        assert(hostFailure?.reason === "consumer_stalled" && hostFailure.childExitObserved, "Host did not confirm stalled child exit");
        assert(event.code === 1011 && exitCode === undefined, "Stall was not reported as abnormal closure");
        assert(entered && sawPause && renderedUpdates === 0, "Held Update rendered or no host pause occurred");
        const rows = Array.from({ length: terminal.buffer.normal.length }, (_, row) => terminal.buffer.normal.getLine(row)?.translateToString(true) ?? "").join("");
        assert(rows.includes("initial") && !rows.includes("value-0001"), "Held replacement appeared in the native display");
        let rejectsFurtherInput = false;
        try { endpoint.push(new Uint8Array()); } catch { rejectsFurtherInput = true; }
        assert(rejectsFurtherInput, "Aborted endpoint accepted more input");
        // Acceptance precedes rendering here. The retained Session snapshot is
        // diagnostic only after abort; do not claim rollback or normal closure.
        result.textContent = "PASS: host stopped the stalled child, observed its exit, and closed with 1011; held Update stayed unrendered and the endpoint rejected further input.\n" +
          JSON.stringify({ hostFailure, heldBytes, renderedUpdates, closeCode: event.code }, null, 2);
        return;
      }
      if (failure) throw failure;
      assert(endpoint.contexts()[0]?.state === "closed", "Context was not closed before EOF cleanup");
      await ingress.finish();
      assert(exitCode === 0, "No successful child exit");
      assert(entered && sawPause && heldBytes > 0, "Render stall did not overlap outstanding host input");
      assert(flow && flow.pauses > 0 && flow.resumes > 0 && flow.outstanding === 0, "Host did not pause, resume, and drain");
      assert(pendingBytes === 0 && renderedUpdates === workload.updates, "Missing rendered Updates or unsettled input");
      const [context] = endpoint.contexts();
      assert(context?.state === "closed" && context.blocks[0]?.lifecycle === "sealed", "Context did not close normally");
      const expected = `value-${String(workload.updates).padStart(4, "0")}\n${"x".repeat(workload.padding)}`;
      assert(context.blocks[0]?.content.data === expected, "Incorrect Session content");
      const range = endpoint.range(context.id, "pressure"); assert(range, "Missing rendered range");
      const buffer = terminal.buffer.normal;
      const rows = Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? "");
      assert(rows.slice(range.start, range.start + range.lineCount).join("") === expected.replace("\n", ""), "Incorrect rendered content");
      const producer = readProducerReport(rows, workload.updates);
      const write = producer.longestWrite;
      const overlapMs = intervalOverlap(write.startedAt, write.endedAt, holdStartedAt, holdEndedAt);
      // Same-host wall clocks correlate intervals; duration itself uses the
      // producer's monotonic clock. Observation is separate from correctness.
      result.textContent = `PASS: ${workload.updates} Updates rendered, host paused/resumed, all credited bytes drained, and Context closed.\n` +
        JSON.stringify({ ...flow, peakPendingBytes, heldBytes,
          holdStartedAt, holdEndedAt, overlapMs, producer }, null, 2);
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
