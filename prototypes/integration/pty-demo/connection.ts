import { WebSocket } from "ws";
import type { IPty } from "node-pty";
import { FlowWindow } from "./flow-window.ts";
import { ConsumptionWatchdog } from "./consumption-watchdog.ts";
import { stopPty } from "./stop-pty.ts";

export interface FlowControl { high: number; low: number; stallMs?: number }

/** Local fixed-child bridge wiring. Kept separate so cleanup faults can be injected. */
export function bindPtyConnection(client: WebSocket, child: IPty, flowControl: FlowControl | undefined,
  releaseSlot: () => void, reportError: (error: unknown) => void = console.error) {
  let exited = false;
  let closed = false;
  let released = false;
  let exitCode: number | undefined;
  let stopped = false;
  let stalled = false;
  let failureReported = false;
  let killRequested = false;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let terminateTimer: ReturnType<typeof setTimeout> | undefined;
  let peakSocketBytes = 0;
  const window = flowControl ? new FlowWindow(flowControl.high, flowControl.low) : undefined;
  const releaseIfFinished = () => {
    if (!closed || !exited || released) return;
    released = true; exitSubscription.dispose(); releaseSlot();
  };
  const kill = () => {
    if (exited || killRequested) return;
    killRequested = true; stopPty(child, reportError);
  };
  const closeSocket = (code: number, reason: string) => {
    if (closed) return;
    // Arm before close: a fake or already-closing peer can close synchronously.
    terminateTimer ??= setTimeout(() => client.terminate(), 1000);
    if (client.readyState === WebSocket.OPEN) client.close(code, reason);
  };
  const reportStall = () => {
    if (failureReported || closed) return;
    failureReported = true; clearTimeout(cleanupTimer);
    try {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({
        type: "host_error", reason: "consumer_stalled", childExitObserved: exited,
      }));
    } catch (error) { reportError(error); }
    closeSocket(1011, "Consumer stalled");
  };
  const watchdog = flowControl?.stallMs === undefined ? undefined : new ConsumptionWatchdog(flowControl.stallMs, () => {
    stopped = true; stalled = true;
    cleanupTimer = setTimeout(reportStall, 2000);
    kill();
    if (exited) reportStall();
  });
  const reportFlow = () => {
    if (window && !stopped && client.readyState === WebSocket.OPEN) client.send(JSON.stringify({
      type: "flow", sent: window.sent, consumed: window.consumed, outstanding: window.outstanding,
      peak: window.peak, paused: window.paused, pauses: window.pauses, resumes: window.resumes, peakSocketBytes,
    }));
  };
  const finishExit = () => {
    if (stopped || exitCode === undefined || (window && window.outstanding !== 0) || client.readyState !== WebSocket.OPEN) return;
    reportFlow(); client.send(JSON.stringify({ type: "exit", code: exitCode }));
    closeSocket(1000, "Child exited");
  };
  const fail = (code: number, reason: string) => {
    stopped = true; watchdog?.dispose(); kill(); closeSocket(code, reason);
  };
  const timer = setTimeout(() => fail(1000, "Demo time limit"), 10 * 60_000);
  const dataSubscription = child.onData(data => {
    if (stopped || closed || client.readyState !== WebSocket.OPEN) return;
    try {
      const bytes = Buffer.from(data, "utf8");
      if (window?.add(bytes.length)) child.pause();
      if (window) watchdog?.update(window.outstanding, window.consumed);
      client.send(bytes); peakSocketBytes = Math.max(peakSocketBytes, client.bufferedAmount); reportFlow();
    } catch (error) { reportError(error); fail(1011, "PTY forwarding failed"); }
  });
  const exitSubscription = child.onExit(event => {
    exited = true; exitCode = event.exitCode;
    try { if (stalled) reportStall(); else finishExit(); }
    catch (error) { reportError(error); fail(1011, "Exit notification failed"); }
    finally { releaseIfFinished(); }
  });
  client.on("message", (bytes, binary) => {
    if (stopped || closed) return;
    try {
      if (binary) { if (!exited) child.write(bytes.toString("utf8")); return; }
      const message = JSON.parse(bytes.toString());
      if (window && message.type === "consumed") {
        if (window.acknowledge(message.total) && !exited) child.resume();
        watchdog?.update(window.outstanding, window.consumed);
        reportFlow(); finishExit(); return;
      }
      if (exited) return;
      if (message.type !== "resize" || !Number.isInteger(message.cols) || !Number.isInteger(message.rows) ||
          message.cols < 10 || message.cols > 160 || message.rows < 4 || message.rows > 50) throw new Error("Invalid resize");
      child.resize(message.cols, message.rows);
    } catch { fail(1008, "Invalid host command"); }
  });
  client.on("error", error => { reportError(error); fail(1011, "WebSocket failed"); });
  client.on("close", () => {
    closed = true; stopped = true;
    clearTimeout(timer); clearTimeout(cleanupTimer); clearTimeout(terminateTimer); watchdog?.dispose();
    dataSubscription.dispose(); kill(); releaseIfFinished();
  });
}
