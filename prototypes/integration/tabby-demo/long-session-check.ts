import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import WebSocket from "ws";

interface ReceiverState {
  completed: number;
  closedBlocks: number;
  sealedBlocks: number;
  lastClosedContextId?: string;
  retainedContexts: number;
  retainedBlocks: number;
  renderedBlocks?: number;
  invalidated: string[];
  bufferText: string;
  failure?: string;
  errors: string[][];
}

interface MemorySample {
  round: number;
  at: string;
  usedJSHeapBytes: number;
  totalJSHeapBytes: number;
  rendererRssBytes: number;
  browserWorkingSetBytes: number;
  rendererWorkingSetBytes: number;
  browserPrivateBytes: number;
  rendererPrivateBytes: number;
  processes: Array<{ Id: number; WorkingSet64: number; PrivateMemorySize64: number; role: string }>;
}

const rounds = integerArgument("--rounds", 20);
const pace = integerArgument("--pace", 5);
const output = stringArgument("--output", ".tmp/tabby-long-session.json");
assert.equal(process.platform, "win32", "This check requires Windows bundled ConPTY and PowerShell.");
assert(rounds >= 1 && rounds <= 500, "Choose between 1 and 500 rounds for this fixture.");
assert(pace >= 1 && pace <= 10_000, "Fixture pacing must be between 1 and 10000 ms.");

const targets = await fetch("http://127.0.0.1:9222/json/list").then(response => response.json());
const target = targets.find((candidate: { type?: string }) => candidate.type === "page");
if (!target) throw new Error("No Tabby page target on port 9222.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
  socket.once("open", () => resolve());
  socket.once("error", reject);
});
let nextId = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
socket.on("message", data => {
  const message = JSON.parse(data.toString());
  if (message.id === undefined) return;
  const entry = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) entry?.reject(new Error(JSON.stringify(message.error)));
  else entry?.resolve(message.result);
});

function call(method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression: string): Promise<any> {
  const result = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}

async function focusTerminal(): Promise<void> {
  await evaluate(`(() => {
    const debug = require("@angular/core").getDebugNode(document.querySelector("[ng-version]"));
    const container = debug.injector.get(require("tabby-core").AppService).activeTab;
    const terminal = container?.session?.middleware
      ? container
      : container?.getFocusedTab?.() ?? container?.getAllTabs?.().at(-1);
    terminal?.frontend?.xterm?.focus();
  })()`);
}

async function typeLine(text: string): Promise<void> {
  await focusTerminal();
  await call("Input.insertText", { text });
  for (const type of ["keyDown", "keyUp"]) {
    await call("Input.dispatchKeyEvent", {
      type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });
  }
}

async function receiverState(): Promise<ReceiverState> {
  return evaluate(`(async () => {
    const receiver = window.__tuiLongReceiver;
    if (!receiver) throw new Error("The protocol receiver is not installed.");
    const contexts = receiver.contexts();
    const metrics = typeof receiver.metrics === "function" ? receiver.metrics() : undefined;
    const closed = contexts.filter(context => context.state === "closed");
    let failure;
    try { await receiver.drain(); } catch (error) { failure = String(error); }
    const debug = require("@angular/core").getDebugNode(document.querySelector("[ng-version]"));
    const container = debug.injector.get(require("tabby-core").AppService).activeTab;
    const component = container?.session?.middleware
      ? container
      : container?.getFocusedTab?.() ?? container?.getAllTabs?.().at(-1);
    const buffer = component.frontend.xterm.buffer.active;
    return {
      completed: metrics?.reclaimClosedContexts ? metrics.closedContexts : closed.length,
      closedBlocks: metrics?.reclaimClosedContexts
        ? metrics.closedBlocks
        : closed.reduce((count, context) => count + context.blocks.length, 0),
      sealedBlocks: metrics?.reclaimClosedContexts
        ? metrics.sealedBlocks
        : closed.reduce((count, context) => count + context.blocks.filter(block => block.lifecycle === "sealed").length, 0),
      lastClosedContextId: metrics?.reclaimClosedContexts
        ? metrics.lastReclaimedContextId
        : closed.at(-1)?.id,
      retainedContexts: contexts.length,
      retainedBlocks: contexts.reduce((count, context) => count + context.blocks.length, 0),
      renderedBlocks: metrics?.renderedBlocks,
      invalidated: contexts.filter(context => context.state === "invalidated").map(context => context.id),
      bufferText: Array.from({ length: buffer.length }, (_, row) =>
        buffer.getLine(row)?.translateToString(true) ?? "").join("\\n"),
      failure,
      errors: window.__tuiLongErrors.slice(),
    };
  })()`);
}

async function memorySample(round: number): Promise<MemorySample> {
  await call("HeapProfiler.collectGarbage");
  const heap = await call("Runtime.getHeapUsage");
  const processInfo = await evaluate(`({
    pid: process.pid,
    ...process.memoryUsage(),
    browserPid: require("@electron/remote").process.pid,
  })`);
  const command = `Get-Process -Id ${processInfo.browserPid},${processInfo.pid} | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`;
  const result = JSON.parse(execFileSync(
    "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" },
  ));
  const processes = (Array.isArray(result) ? result : [result]).map((entry: any) => ({
    ...entry,
    role: entry.Id === processInfo.browserPid ? "browser" : entry.Id === processInfo.pid ? "renderer" : "unknown",
  }));
  const browser = processes.find((entry: any) => entry.role === "browser");
  const renderer = processes.find((entry: any) => entry.role === "renderer");
  assert(browser && renderer, "Working-set sampling must identify the browser and renderer PIDs.");
  return {
    round,
    at: new Date().toISOString(),
    usedJSHeapBytes: heap.usedSize,
    totalJSHeapBytes: heap.totalSize,
    rendererRssBytes: processInfo.rss,
    browserWorkingSetBytes: browser.WorkingSet64,
    rendererWorkingSetBytes: renderer.WorkingSet64,
    browserPrivateBytes: browser.PrivateMemorySize64,
    rendererPrivateBytes: renderer.PrivateMemorySize64,
    processes,
  };
}

const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  requestedRounds: rounds,
  paceMs: pace,
  gcBeforeMemorySample: true,
  memoryMethod: "CDP Runtime.getHeapUsage and process.memoryUsage; PowerShell Get-Process WorkingSet64 and PrivateMemorySize64",
};
const roundStates: unknown[] = [];
const memorySamples: MemorySample[] = [];
let currentState: ReceiverState | undefined;
try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("HeapProfiler.enable");
  report.profile = await evaluate(`(async () => {
    const debug = require("@angular/core").getDebugNode(document.querySelector("[ng-version]"));
    const profiles = debug.injector.get(require("tabby-core").ProfilesService);
    const available = await profiles.getProfiles();
    const profile = available.find(value => value.name.includes("CMD")) ?? available[0];
    await profiles.openNewTabForProfile(profile);
    return profile.name;
  })()`);
  let middleware: any;
  const middlewareDeadline = Date.now() + 60000;
  while (true) {
    await focusTerminal();
    middleware = await call("Runtime.evaluate", {
      expression: `(() => {
        const debug = require("@angular/core").getDebugNode(document.querySelector("[ng-version]"));
        const container = debug.injector.get(require("tabby-core").AppService).activeTab;
        const terminal = container?.session?.middleware
          ? container
          : container?.getFocusedTab?.() ?? container?.getAllTabs?.().at(-1);
        return terminal?.session?.middleware?.stack?.find(value =>
          !["ZModemMiddleware", "SessionMiddleware", "OSCProcessor"].includes(value.constructor.name));
      })()`,
      returnByValue: false,
    });
    if (middleware.result?.objectId && middleware.result?.subtype !== "error") break;
    if (Date.now() > middlewareDeadline) {
      throw new Error(`No protocol middleware in the new Tabby terminal: ${JSON.stringify(middleware)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  let receiverId: string | undefined;
  let receiverProperties: any;
  const receiverDeadline = Date.now() + 60000;
  while (!receiverId) {
    receiverProperties = await call("Runtime.getProperties", { objectId: middleware.result.objectId, ownProperties: true });
    receiverId = receiverProperties.privateProperties?.find((property: any) => property.value?.objectId)?.value.objectId;
    if (receiverId) break;
    if (Date.now() > receiverDeadline) {
      throw new Error(`No protocol receiver in the protocol middleware: ${JSON.stringify(receiverProperties)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await call("Runtime.callFunctionOn", {
    objectId: receiverId,
    functionDeclaration: `function () {
      window.__tuiLongReceiver = this;
      window.__tuiLongErrors = [];
      window.__tuiLongOriginalError = console.error;
      console.error = (...args) => {
        if (String(args[0]).startsWith("tui-protocol")) window.__tuiLongErrors.push(args.map(String));
        window.__tuiLongOriginalError(...args);
      };
    }`,
  });
  const requestBudget = rounds * 2;
  report.requestBudget = requestBudget;
  await typeLine(`cd /d ${JSON.stringify(process.cwd())} && set PI_TRIAL_PACE=${pace}&& set PI_TRIAL_MAX_REQUESTS=${requestBudget}&& node prototypes/integration/pi-stock-ui/main.ts`);
  const startupDeadline = Date.now() + 60000;
  while (true) {
    const state = await receiverState();
    if (state.bufferText.includes("protocol supported; transcript is terminal-owned")) break;
    if (state.failure || state.errors.length > 0 || Date.now() > startupDeadline) {
      throw new Error(`Pi protocol startup failed: ${JSON.stringify(state)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  currentState = await receiverState();
  memorySamples.push(await memorySample(0));
  for (let round = 1; round <= rounds; round += 1) {
    await typeLine(`long session round ${round}`);
    const deadline = Date.now() + 60000;
    while (true) {
      currentState = await receiverState();
      if (currentState.failure || currentState.errors.length > 0 || currentState.invalidated.length > 0) {
        throw new Error(`Protocol failure in round ${round}: ${JSON.stringify(currentState)}`);
      }
      if (currentState.completed >= round) break;
      if (Date.now() > deadline) throw new Error(`Timed out in round ${round}: ${JSON.stringify(currentState)}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const { bufferText: _bufferText, ...state } = currentState;
    roundStates.push({ round, ...state });
    console.log(`round ${round}: ${state.completed} Contexts, ${state.closedBlocks} Blocks`);
    if (round % 5 === 0 || round === rounds) {
      const sample = await memorySample(round);
      memorySamples.push(sample);
      console.log(`memory at ${round}: JS heap ${(sample.usedJSHeapBytes / 1048576).toFixed(2)} MiB`);
    }
  }
  assert(currentState);
  assert.equal(currentState.completed, rounds);
  assert.equal(currentState.lastClosedContextId, `context-${rounds}`);
  assert.equal(currentState.closedBlocks, rounds * 2 + 2);
  assert.equal(currentState.sealedBlocks, currentState.closedBlocks);
  assert.deepEqual(currentState.invalidated, []);
  const retainedLines = currentState.bufferText.split("\n");
  for (let round = Math.max(1, rounds - 19); round <= rounds; round += 1) {
    const marker = `long session round ${round}`;
    assert.equal(retainedLines.filter(line => line === marker).length, 1, `one retained copy of ${marker}`);
  }
  report.completed = true;
  const { bufferText: _bufferText, ...finalState } = currentState;
  report.finalState = finalState;
} catch (error) {
  report.completed = false;
  report.error = error instanceof Error ? error.stack : String(error);
  if (currentState !== undefined) {
    const { bufferText: _bufferText, ...state } = currentState;
    report.lastState = state;
  }
  process.exitCode = 1;
  console.error(report.error);
} finally {
  report.roundStates = roundStates;
  report.memorySamples = memorySamples;
  report.finishedAt = new Date().toISOString();
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  try {
    await evaluate("console.error = window.__tuiLongOriginalError ?? console.error");
  } catch {}
  socket.close();
  console.log(`report: ${resolve(output)}`);
}

function integerArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : Number(process.argv[index + 1]);
}

function stringArgument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
