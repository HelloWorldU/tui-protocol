import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  ProtocolStreamDecoder,
  encodeMessageFrames,
  type Message,
} from "../../reference-codec/index.ts";
import type { EndpointResult } from "../protocol-endpoint/index.ts";
import { BrowserXtermProtocolEndpoint } from "./browser-endpoint.ts";
import "./style.css";

interface ScenarioResult {
  readonly name: string;
  readonly detail: string;
}

interface Fixture {
  readonly contextId: string;
  readonly endpoint: BrowserXtermProtocolEndpoint;
  readonly terminal: Terminal;
  dispose(): void;
}

interface InputSnapshot {
  readonly absoluteRow: number;
  readonly cursorX: number;
  readonly focused: boolean;
  readonly text: string;
}

const terminalElement = requiredElement("terminal");
const summaryElement = requiredElement("summary");
const resultsElement = requiredElement("results");

const terminal = new Terminal({ cols: 20, rows: 4, scrollback: 100 });
terminal.open(terminalElement);

try {
  const results = await runScenarios();
  summaryElement.textContent = `${results.length} browser endpoint scenarios passed.`;
  summaryElement.dataset.status = "passed";
  for (const result of results) {
    const item = document.createElement("li");
    item.textContent = `${result.name}: ${result.detail}`;
    item.dataset.status = "passed";
    resultsElement.appendChild(item);
  }
} catch (error) {
  summaryElement.textContent = `Scenario failed: ${errorMessage(error)}`;
  summaryElement.dataset.status = "failed";
  throw error;
}

async function runScenarios(): Promise<ScenarioResult[]> {
  return [
    await runSelectionAndReadingScenario(),
    await runSearchScenario(),
    await runActiveInputAndCompositionScenario(),
  ];
}

async function runSelectionAndReadingScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "earlier", "old", "mutable"),
      append(fixture.contextId, "2", "reader", "reader", "sealed"),
      append(
        fixture.contextId,
        "3",
        "selected",
        "selected-copy",
        "sealed",
      ),
      append(
        fixture.contextId,
        "4",
        "tail",
        "tail-1\ntail-2\ntail-3\ntail-4",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    const readerBefore = requiredRange(fixture, "reader");
    const selectedBefore = requiredRange(fixture, "selected");
    fixture.terminal.scrollToLine(readerBefore.start);
    fixture.terminal.select(0, selectedBefore.start, "selected-copy".length);
    assertEqual(fixture.terminal.getSelection(), "selected-copy", "selection before Update");
    assertEqual(copySelection(fixture.terminal), "selected-copy", "copy before Update");
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      readerBefore.start,
      "reading row before Update",
    );

    pushMessages(fixture.endpoint, [
      update(
        fixture.contextId,
        "5",
        "earlier",
        "new-1\nnew-2\nnew-3",
      ),
    ]);
    await fixture.endpoint.drain();

    const readerAfter = requiredRange(fixture, "reader");
    const selectedAfter = requiredRange(fixture, "selected");
    assertEqual(
      selectedAfter.start,
      selectedBefore.start + 2,
      "selected Block row after earlier growth",
    );
    assertEqual(
      fixture.terminal.buffer.active.viewportY,
      readerAfter.start,
      "reading row after earlier growth",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      selectedAfter.start,
      "selection row after earlier growth",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "selected-copy",
      "selection after OSC Update",
    );
    assertEqual(
      copySelection(fixture.terminal),
      "selected-copy",
      "copy after OSC Update",
    );
    assertBlockContent(fixture, "earlier", "new-1\nnew-2\nnew-3");
    return {
      name: "OSC Update Preserves Reading Position and Selection",
      detail: "the later selected Block moved while its viewport row and copy text stayed intact",
    };
  } finally {
    fixture.dispose();
  }
}

async function runSearchScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "earlier", "old", "mutable"),
      append(
        fixture.contextId,
        "2",
        "search-result",
        "find-the-needle",
        "sealed",
      ),
      append(
        fixture.contextId,
        "3",
        "tail",
        "tail",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    assertEqual(fixture.endpoint.findNext("needle"), true, "initial search");
    const resultBefore = requiredRange(fixture, "search-result");
    assertEqual(fixture.terminal.getSelection(), "needle", "initial search match");

    pushMessages(fixture.endpoint, [
      update(
        fixture.contextId,
        "4",
        "earlier",
        "new-1\nnew-2\nnew-3",
      ),
    ]);
    await fixture.endpoint.drain();

    const resultAfter = requiredRange(fixture, "search-result");
    assertEqual(
      resultAfter.start,
      resultBefore.start + 2,
      "search-result Block row after earlier growth",
    );
    assertEqual(
      fixture.terminal.getSelection(),
      "needle",
      "current search match after OSC Update",
    );
    assertEqual(
      fixture.terminal.getSelectionPosition()?.start.y,
      resultAfter.start,
      "current search match row after OSC Update",
    );
    assertBlockContent(fixture, "earlier", "new-1\nnew-2\nnew-3");
    return {
      name: "OSC Update Preserves Current Search Match",
      detail: "the current match moved with its unchanged Block",
    };
  } finally {
    fixture.dispose();
  }
}

async function runActiveInputAndCompositionScenario(): Promise<ScenarioResult> {
  const fixture = createFixture();
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "earlier", "old", "mutable"),
      append(
        fixture.contextId,
        "2",
        "tail",
        "tail-1\ntail-2\ntail-3",
        "sealed",
      ),
    ]);
    await fixture.endpoint.drain();

    await write(fixture.terminal, "> draft command");
    await write(fixture.terminal, "\u001b[8D");
    fixture.terminal.focus();
    const inputBefore = inputSnapshot(fixture.terminal);
    const textarea = requiredTextarea(fixture.terminal);
    const compositionView = requiredCompositionView(fixture.terminal);
    let compositionEndCount = 0;
    let dataSent = "";
    textarea.addEventListener("compositionend", () => {
      compositionEndCount += 1;
    });
    const dataRegistration = fixture.terminal.onData((data) => {
      dataSent += data;
    });

    textarea.value = "";
    textarea.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );
    textarea.value = "拼";
    textarea.dispatchEvent(
      new CompositionEvent("compositionupdate", { bubbles: true, data: "拼" }),
    );
    await nextTurn();

    pushMessages(fixture.endpoint, [
      update(
        fixture.contextId,
        "3",
        "earlier",
        "new-1\nnew-2\nnew-3",
      ),
    ]);
    await fixture.endpoint.drain();
    await nextTurn();

    const inputAfter = inputSnapshot(fixture.terminal);
    assertEqual(inputAfter.text, inputBefore.text, "active input text after OSC Update");
    assertEqual(inputAfter.cursorX, inputBefore.cursorX, "input cursor after OSC Update");
    assertEqual(inputAfter.focused, true, "input focus after OSC Update");
    assertTrue(
      inputAfter.absoluteRow > inputBefore.absoluteRow,
      "active input moved below the taller history",
    );
    assertEqual(compositionEndCount, 0, "compositionend events during OSC Update");
    assertEqual(dataSent, "", "input data sent during OSC Update");
    assertEqual(textarea.value, "拼", "textarea value during composition");
    assertEqual(compositionView.textContent, "拼", "composition view text");
    assertTrue(
      compositionView.classList.contains("active"),
      "composition view after OSC Update",
    );
    assertBlockContent(fixture, "earlier", "new-1\nnew-2\nnew-3");

    textarea.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "拼" }),
    );
    await nextTurn();
    dataRegistration.dispose();
    return {
      name: "OSC Update Preserves Active Input and Composition",
      detail: "the input text, cursor, focus, and synthetic composition stayed active",
    };
  } finally {
    fixture.dispose();
  }
}

function createFixture(): Fixture {
  const host = document.createElement("div");
  host.className = "isolated-terminal";
  document.body.appendChild(host);
  const fixtureTerminal = new Terminal({ cols: 20, rows: 4, scrollback: 100 });
  fixtureTerminal.open(host);
  const endpoint = new BrowserXtermProtocolEndpoint(fixtureTerminal);
  const contextId = negotiateAndOpen(endpoint);
  return {
    contextId,
    endpoint,
    terminal: fixtureTerminal,
    dispose(): void {
      endpoint.dispose();
      fixtureTerminal.dispose();
      host.remove();
    },
  };
}

function negotiateAndOpen(endpoint: BrowserXtermProtocolEndpoint): string {
  const capability = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "capability.query",
        request_id: "capability-1",
        body: {},
      },
      1,
    ),
  );
  const [capabilityResponse] = decodeResponses(capability);
  assertEqual(capabilityResponse?.kind, "capability.response", "capability response kind");
  if (capabilityResponse?.kind !== "capability.response") {
    throw new Error("Expected a capability.response Message.");
  }
  assertEqual(capabilityResponse.body.outcome, "supported", "capability outcome");

  const opened = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "context.open",
        request_id: "open-1",
        body: {},
      },
      2,
    ),
  );
  const [openResponse] = decodeResponses(opened);
  if (
    openResponse?.kind !== "context.open.response" ||
    !("context_id" in openResponse)
  ) {
    throw new Error("Expected a successful context.open.response Message.");
  }
  return openResponse.context_id;
}

function pushMessages(
  endpoint: BrowserXtermProtocolEndpoint,
  messages: readonly Message[],
): void {
  const result = endpoint.push(
    concatenate(
      messages.map((message, index) => encodeInput(message, index + 3)),
    ),
  );
  assertEqual(result.diagnostics.length, 0, "endpoint diagnostics");
  assertEqual(result.responseFrames.length, 0, "unexpected response frames");
}

function append(
  contextId: string,
  operationId: string,
  blockId: string,
  content: string,
  lifecycle: "mutable" | "sealed",
): Message {
  return {
    version: 1,
    kind: "block.append",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      lifecycle,
      content: { type: "text/plain", data: content },
    },
  };
}

function update(
  contextId: string,
  operationId: string,
  blockId: string,
  content: string,
): Message {
  return {
    version: 1,
    kind: "block.update",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      content: { type: "text/plain", data: content },
    },
  };
}

function encodeInput(message: Message, frameId: number): Uint8Array {
  return concatenate(encodeMessageFrames(message, frameId));
}

function decodeResponses(result: EndpointResult): readonly Message[] {
  const decoder = new ProtocolStreamDecoder();
  const events = result.responseFrames.flatMap((frame) => decoder.push(frame));
  if (!events.every((event) => event.type === "message")) {
    throw new Error("The endpoint returned an invalid response frame.");
  }
  return events.flatMap((event) =>
    event.type === "message" ? [event.message] : [],
  );
}

function requiredRange(
  fixture: Fixture,
  blockId: string,
): { readonly start: number; readonly lineCount: number } {
  const range = fixture.endpoint.range(fixture.contextId, blockId);
  if (range === undefined) {
    throw new Error(`Block ${JSON.stringify(blockId)} has no rendered range.`);
  }
  return range;
}

function assertBlockContent(
  fixture: Fixture,
  blockId: string,
  expected: string,
): void {
  const content = fixture.endpoint
    .context(fixture.contextId)
    ?.blocks.find((block) => block.id === blockId)?.content.data;
  assertEqual(content, expected, `${blockId} Session content`);
}

function inputSnapshot(source: Terminal): InputSnapshot {
  const buffer = source.buffer.active;
  const absoluteRow = buffer.baseY + buffer.cursorY;
  const text = buffer.getLine(absoluteRow)?.translateToString(true);
  if (text === undefined) {
    throw new Error(`Active input row ${absoluteRow} is missing.`);
  }
  return {
    absoluteRow,
    cursorX: buffer.cursorX,
    focused: document.activeElement === source.textarea,
    text,
  };
}

function copySelection(source: Terminal): string | undefined {
  let copied: string | undefined;
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData(type: string, value: string): void {
        if (type === "text/plain") {
          copied = value;
        }
      },
    },
  });
  source.element?.dispatchEvent(event);
  return copied;
}

function requiredTextarea(source: Terminal): HTMLTextAreaElement {
  if (source.textarea === undefined) {
    throw new Error("xterm did not create its input textarea.");
  }
  return source.textarea;
}

function requiredCompositionView(source: Terminal): HTMLElement {
  const view = source.element?.querySelector<HTMLElement>(".composition-view");
  if (view === null || view === undefined) {
    throw new Error("xterm did not create its composition view.");
  }
  return view;
}

function write(source: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => source.write(data, resolve));
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Element ${JSON.stringify(id)} is missing.`);
  }
  return element;
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function assertTrue(value: boolean, label: string): void {
  if (!value) {
    throw new Error(`${label}: expected true, received false.`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
