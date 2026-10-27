import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";

const outputPath = process.argv[2] ?? ".tmp/tabby-side-by-side-report.json";
const RESULT_TEXT = "The sample reports: mutable history keeps old output readable.";
const SEARCH_TEXT = "mutable history keeps old output";
const frameDirectory = resolve(".tmp/tabby-side-by-side-frames");
const targets = await fetch("http://127.0.0.1:9222/json/list").then(response => response.json());
const target = targets.find((candidate: { type?: string }) => candidate.type === "page");
if (!target) throw new Error("No visible Tabby page on CDP port 9222.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
  socket.once("open", () => resolve());
  socket.once("error", reject);
});
let nextId = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const frames: Array<{ sessionId: number; data: string; metadata: { timestamp: number } }> = [];
socket.on("message", data => {
  const message = JSON.parse(data.toString());
  if (message.id !== undefined) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry?.reject(new Error(JSON.stringify(message.error)));
    else entry?.resolve(message.result);
    return;
  }
  if (message.method === "Page.screencastFrame") {
    frames.push(message.params);
    void call("Page.screencastFrameAck", { sessionId: message.params.sessionId });
  }
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

async function waitFor(predicate: () => Promise<boolean> | boolean, reason: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`Timed out: ${reason}`);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

async function focus(role: "stock" | "protocol" | "controller"): Promise<void> {
  await waitFor(() => evaluate(`window.__pairTabs[${JSON.stringify(role)}]?.frontend?.xterm !== undefined`), `${role} frontend to initialize`);
  await evaluate(`(() => {
    const debug = require("@angular/core").getDebugNode(document.querySelector("[ng-version]"));
    const app = debug.injector.get(require("tabby-core").AppService);
    const root = ${JSON.stringify(role)} === "controller" ? window.__pairRoots.controller : window.__pairRoots.pair;
    const tab = window.__pairTabs[${JSON.stringify(role)}];
    app.selectTab(root);
    if (root.getFocusedTab?.() !== tab) root.focus(tab);
    tab.frontend.xterm.focus();
  })()`);
  await waitFor(() => evaluate(`(() => {
    const tab = window.__pairTabs[${JSON.stringify(role)}];
    const textarea = tab.frontend.xterm.element?.querySelector("textarea");
    return document.activeElement === textarea;
  })()`), `${role} DOM focus`);
}

async function type(role: "stock" | "protocol" | "controller", text: string): Promise<void> {
  await focus(role);
  if (text.startsWith("cd /d")) {
    await waitFor(() => evaluate(`(() => {
      const tab = window.__pairTabs[${JSON.stringify(role)}];
      if (tab.session?.open !== true) return false;
      const buffer = tab.frontend.xterm.buffer.active;
      const lines = Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true).trimEnd() ?? "");
      return lines.filter(Boolean).at(-1)?.endsWith(">") === true;
    })()`), `${role} shell prompt`, 60000);
  }
  await call("Input.insertText", { text });
  const suffix = text.split(/\s+/).at(-1) ?? text;
  await waitFor(async () => logicalCount((await snapshot(role)).lines.join("\n"), suffix) > 0,
    `${role} input to be parsed`, 60000);
  await focus(role);
  for (const type of ["keyDown", "keyUp"]) {
    await call("Input.dispatchKeyEvent", {
      type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });
  }
}

async function snapshot(role: "stock" | "protocol" | "controller"): Promise<any> {
  return evaluate(`(() => {
    const tab = window.__pairTabs[${JSON.stringify(role)}];
    const terminal = tab.frontend.xterm;
    const buffer = terminal.buffer.active;
    return {
      cols: terminal.cols,
      rows: terminal.rows,
      viewportY: buffer.viewportY,
      baseY: buffer.baseY,
      selection: terminal.getSelection(),
      lines: Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? ""),
    };
  })()`);
}

async function controllerText(): Promise<string> {
  const current = await snapshot("controller");
  return current.lines.join("\n");
}

async function metrics(): Promise<any> {
  return evaluate("window.__protocolReceiver?.metrics()");
}

async function scrollToMarker(role: "stock" | "protocol", marker: string): Promise<any> {
  await waitFor(async () => (await snapshot(role)).lines.some((line: string) => line.includes(marker)),
    `${role} marker to be rendered: ${marker}`);
  const current = await snapshot(role);
  const row = current.lines.findIndex((line: string) => line.includes(marker));
  assert(row >= 0, `${role} marker not found: ${marker}`);
  await evaluate(`window.__pairTabs[${JSON.stringify(role)}].frontend.xterm.scrollToLine(${row})`);
  const after = await snapshot(role);
  return { row, viewportY: after.viewportY, rows: after.rows, selection: after.selection };
}

function visible(observation: { row: number; viewportY: number; rows: number }): boolean {
  return observation.row >= observation.viewportY && observation.row < observation.viewportY + observation.rows;
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function logicalCount(text: string, needle: string): number {
  const normalize = (value: string) => value.replaceAll(/\s+/g, "");
  return count(normalize(text), normalize(needle));
}

function layoutMatches(lines: string[], cols: number): boolean {
  if (cols === 36) {
    return lines.includes("The sample reports: mutable history") &&
      lines.some(line => line.trim() === "keeps old output readable.") &&
      lines.includes("- Styling comes from Pi's real") &&
      lines.some(line => line.trim() === "renderer") &&
      !lines.some(line => line === "r" || line.startsWith("enderer"));
  }
  return lines.includes("The sample reports: mutable history keeps old output") &&
    lines.includes("- Styling comes from Pi's real renderer") &&
    !lines.some(line => line.trim() === "renderer");
}

const report: Record<string, unknown> = { completed: false, observations: {} };
const observations: Record<string, unknown> = {};
let screencastStarted = false;
try {
  await call("Page.enable");
  await call("Runtime.enable");
  await evaluate(`(async () => {
    const debug = require("@angular/core").getDebugNode(document.querySelector("[ng-version]"));
    const app = debug.injector.get(require("tabby-core").AppService);
    const profiles = debug.injector.get(require("tabby-core").ProfilesService);
    const available = await profiles.getProfiles();
    const profile = available.find(value => value.name.includes("CMD")) ?? available[0];
    const stock = await profiles.openNewTabForProfile(profile);
    const split = app.activeTab;
    const protocol = await split.splitTab(stock, "r");
    const controller = await profiles.openNewTabForProfile(profile);
    window.__pairRoots = { pair: split, controller: app.activeTab };
    window.__pairTabs = { stock, protocol, controller };
  })()`);
  await type("controller", `cd /d ${JSON.stringify(process.cwd())} && set PI_TRIAL_TOOL_PAUSE=6000&& set PI_TRIAL_DEMO_TEXT=1&& set PI_TRIAL_PACE=150&& node prototypes/integration/pi-stock-ui/pair-main.ts`);
  await waitFor(async () => (await controllerText()).includes("host listening on 4194"), "pair host to listen");
  const token = (await controllerText()).match(/token ([0-9a-f]+)/)?.[1];
  assert(token, "pair token missing from controller output");
  await type("stock", `cd /d ${JSON.stringify(process.cwd())} && set PI_PAIR_PORT=4194&& node prototypes/integration/pi-stock-ui/channel-client.ts stock ${token}`);
  await type("protocol", `cd /d ${JSON.stringify(process.cwd())} && set PI_PAIR_PORT=4194&& node prototypes/integration/pi-stock-ui/channel-client.ts protocol ${token}`);
  await waitFor(async () => (await controllerText()).includes("frontends ready"), "both paired frontends to initialize");

  const middleware = await call("Runtime.evaluate", {
    expression: `(() => {
      const tab = window.__pairTabs.protocol;
      return tab.session.middleware.stack.find(value =>
        !["ZModemMiddleware", "SessionMiddleware", "OSCProcessor"].includes(value.constructor.name));
    })()`,
    returnByValue: false,
  });
  assert(middleware.result?.objectId, "protocol middleware missing");
  const properties = await call("Runtime.getProperties", { objectId: middleware.result.objectId, ownProperties: true });
  const receiverId = properties.privateProperties?.[0]?.value?.objectId;
  assert(receiverId, "protocol receiver missing");
  await call("Runtime.callFunctionOn", {
    objectId: receiverId,
    functionDeclaration: "function () { window.__protocolReceiver = this; }",
  });

  await call("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
  screencastStarted = true;
  await type("protocol", "Read the trial sample using read_trial_sample, then give a brief answer.");
  await waitFor(async () => (await controllerText()).includes("phase tool_progress"), "the tool progress before its final result", 30000);
  const stockBefore = await scrollToMarker("stock", "Reading the local sample.");
  const protocolBefore = await scrollToMarker("protocol", "Reading the local sample.");
  observations.readingBefore = { stock: stockBefore, protocol: protocolBefore };
  assert(visible(stockBefore), "stock marker must be visible before the historical update");
  assert(visible(protocolBefore), "protocol marker must be visible before the historical update");

  await waitFor(async () => (await controllerText()).includes("phase complete; toolCalls=1"), "the single tool call to complete", 30000);
  await waitFor(async () => (await metrics())?.closedContexts === 1, "the protocol Context to close");
  const finalMetrics = await metrics();
  assert.deepEqual(finalMetrics, {
    reclaimClosedContexts: true,
    closedContexts: 1,
    closedBlocks: 4,
    sealedBlocks: 4,
    lastReclaimedContextId: "context-1",
    renderedBlocks: 4,
  });
  const stockAfter = await snapshot("stock");
  const protocolAfter = await snapshot("protocol");
  observations.progressAfterUpdate = {
    stock: count(stockAfter.lines.join("\n"), "Reading sample..."),
    protocol: count(protocolAfter.lines.join("\n"), "Reading sample..."),
  };
  assert.equal(count(protocolAfter.lines.join("\n"), "Reading sample..."), 0, "protocol retained obsolete tool progress");
  observations.resultAfterUpdate = {
    stock: logicalCount(stockAfter.lines.join("\n"), RESULT_TEXT),
    protocol: logicalCount(protocolAfter.lines.join("\n"), RESULT_TEXT),
  };
  assert.equal(logicalCount(protocolAfter.lines.join("\n"), RESULT_TEXT), 1, "protocol duplicated its final result");
  assert(logicalCount(stockAfter.lines.join("\n"), RESULT_TEXT) >= 1, "stock lost its final result");
  for (const [role, current] of [["stock", stockAfter], ["protocol", protocolAfter]] as const) {
    const text = current.lines.join("\n");
    if (role === "protocol") assert.equal(count(text, "The sample reports: mutable history"), 1, "protocol assistant answer count");
    else assert(count(text, "The sample reports: mutable history") >= 1, "stock assistant answer missing");
    if (role === "protocol") assert.equal(count(text, "User:\n"), 1, "protocol user Block count");
    else assert.equal(logicalCount(text, "Read the trial sample using read_trial_sample"), 1, "stock prompt count");
  }
  const protocolAfterUpdate = await scrollToMarker("protocol", "Reading the local sample.");
  const stockAfterUpdate = await scrollToMarker("stock", "Reading the local sample.");
  observations.readingAfterUpdate = { stock: stockAfterUpdate, protocol: protocolAfterUpdate };
  assert(visible(protocolAfterUpdate), "protocol reading position was lost after the historical update");
  observations.metricsAfterUpdate = finalMetrics;

  const resizeObservations: unknown[] = [];
  for (const cols of [36, 60]) {
    for (const role of ["stock", "protocol"] as const) {
      await evaluate(`(() => {
        const tab = window.__pairTabs.${role};
        tab.session.resize(${cols}, 24);
        tab.frontend.xterm.resize(${cols}, 24);
      })()`);
    }
    await waitFor(async () => {
      const stock = await snapshot("stock");
      const protocol = await snapshot("protocol");
      return stock.cols === cols && protocol.cols === cols && layoutMatches(protocol.lines, cols);
    }, `both PTYs and the protocol layout to reach ${cols} columns`);
    await evaluate("window.__protocolReceiver.drain()");
    const stock = await snapshot("stock");
    const protocol = await snapshot("protocol");
    assert(logicalCount(stock.lines.join("\n"), RESULT_TEXT) >= 1, `stock result missing after resize to ${cols}`);
    assert.equal(logicalCount(protocol.lines.join("\n"), RESULT_TEXT), 1, `protocol result duplicated after resize to ${cols}`);
    const reading = await scrollToMarker("protocol", "Reading the local sample.");
    assert(visible(reading), `protocol reading position was lost at ${cols} columns`);
    resizeObservations.push({ cols, stock, protocol, reading });
  }
  observations.resize = resizeObservations;

  const search: Record<string, unknown> = {};
  for (const role of ["stock", "protocol"] as const) {
    const found = await evaluate(`window.__pairTabs.${role}.frontend.findNext(${JSON.stringify(SEARCH_TEXT)})`);
    assert(found.resultCount >= 1, `${role} could not search the final result`);
    const selected = await evaluate(`window.__pairTabs.${role}.frontend.xterm.getSelection()`);
    assert(selected.includes(SEARCH_TEXT), `${role} search selected stale text`);
    const obsolete = await evaluate(`window.__pairTabs.${role}.frontend.findNext("Reading sample...")`);
    if (role === "protocol") assert.equal(obsolete.resultCount, 0, "protocol still searches obsolete tool progress");
    search[role] = { found, selected, obsolete };
  }
  observations.search = search;
  await evaluate(`window.__pairTabs.protocol.frontend.findNext(${JSON.stringify(SEARCH_TEXT)})`);
  assert((await evaluate("window.__pairTabs.protocol.frontend.xterm.getSelection()")).includes(SEARCH_TEXT),
    "the final result is not selected before copying");

  const copied = await evaluate(`(() => {
    window.__copiedText = undefined;
    const platform = window.__pairTabs.protocol.frontend.platformService;
    const originalSetClipboard = platform.setClipboard;
    try {
      platform.setClipboard = content => {
        window.__copiedText = typeof content === "string" ? content : content.text;
      };
      window.__pairTabs.protocol.frontend.copySelection();
      return window.__copiedText;
    } finally {
      platform.setClipboard = originalSetClipboard;
    }
  })()`);
  assert(copied.includes(SEARCH_TEXT), "copy did not return the selected logical result");
  observations.copy = copied;
  observations.controller = await controllerText();
  report.completed = true;
  report.observations = observations;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  report.observations = observations;
  process.exitCode = 1;
  console.error(report.error);
} finally {
  if (screencastStarted) await call("Page.stopScreencast");
  mkdirSync(frameDirectory, { recursive: true });
  const metadata: unknown[] = [];
  for (const [index, frame] of frames.entries()) {
    const name = `frame-${String(index).padStart(6, "0")}.jpg`;
    writeFileSync(resolve(frameDirectory, name), Buffer.from(frame.data, "base64"));
    metadata.push({ file: name, timestamp: frame.metadata.timestamp });
  }
  writeFileSync(resolve(frameDirectory, "frames.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(resolve(frameDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
  const screenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(resolve(".tmp/tabby-side-by-side-final.png"), Buffer.from(screenshot.data, "base64"));
  socket.close();
  console.log(`report: ${resolve(outputPath)}`);
  console.log(`frames: ${metadata.length}`);
}
