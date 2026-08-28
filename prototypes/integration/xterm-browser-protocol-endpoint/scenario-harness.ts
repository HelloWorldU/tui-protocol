import { Terminal } from "@xterm/xterm";

import {
  ProtocolStreamDecoder,
  encodeMessageFrames,
  type Message,
} from "../../reference-codec/index.ts";
import type { EndpointResult } from "../protocol-endpoint/index.ts";
import { BrowserXtermProtocolEndpoint } from "./browser-endpoint.ts";

export interface ScenarioResult {
  readonly name: string;
  readonly detail: string;
}

export interface Fixture {
  readonly contextId: string;
  readonly endpoint: BrowserXtermProtocolEndpoint;
  readonly terminal: Terminal;
  dispose(): void;
}

export interface FixtureOptions {
  readonly cols?: number;
  readonly rows?: number;
  readonly scrollback?: number;
}

export interface InputSnapshot {
  readonly absoluteRow: number;
  readonly cursorX: number;
  readonly focused: boolean;
  readonly text: string;
}
export function createFixture(options: FixtureOptions = {}): Fixture {
  const host = document.createElement("div");
  host.className = "isolated-terminal";
  document.body.appendChild(host);
  const fixtureTerminal = new Terminal({
    cols: options.cols ?? 20,
    rows: options.rows ?? 4,
    scrollback: options.scrollback ?? 100,
  });
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

export function pushMessages(
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

export function append(
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

export function update(
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

export function extend(
  contextId: string,
  operationId: string,
  blockId: string,
  baseOperationId: string,
  fragment: string,
): Message {
  return {
    version: 1,
    kind: "block.extend",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      base_operation_id: baseOperationId,
      fragment,
    },
  };
}

export function replaceSuffix(
  contextId: string,
  operationId: string,
  blockId: string,
  baseOperationId: string,
  retain: number,
  replacement: string,
): Message {
  return {
    version: 1,
    kind: "block.replace_suffix",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      base_operation_id: baseOperationId,
      retain,
      replacement,
    },
  };
}

export function seal(
  contextId: string,
  operationId: string,
  blockId: string,
): Message {
  return {
    version: 1,
    kind: "block.seal",
    operation_id: operationId,
    context_id: contextId,
    body: { block_id: blockId },
  };
}

export function encodeInput(message: Message, frameId: number): Uint8Array {
  return concatenate(encodeMessageFrames(message, frameId));
}

export function decodeResponses(result: EndpointResult): readonly Message[] {
  const decoder = new ProtocolStreamDecoder();
  const events = result.responseFrames.flatMap((frame) => decoder.push(frame));
  if (!events.every((event) => event.type === "message")) {
    throw new Error("The endpoint returned an invalid response frame.");
  }
  return events.flatMap((event) =>
    event.type === "message" ? [event.message] : [],
  );
}

export function requiredRange(
  fixture: Fixture,
  blockId: string,
): { readonly start: number; readonly lineCount: number } {
  const range = fixture.endpoint.range(fixture.contextId, blockId);
  if (range === undefined) {
    throw new Error(`Block ${JSON.stringify(blockId)} has no rendered range.`);
  }
  return range;
}

export function assertBlockContent(
  fixture: Fixture,
  blockId: string,
  expected: string,
): void {
  const content = fixture.endpoint
    .context(fixture.contextId)
    ?.blocks.find((block) => block.id === blockId)?.content.data;
  assertEqual(content, expected, `${blockId} Session content`);
}

export function assertBlockLifecycle(
  fixture: Fixture,
  blockId: string,
  expected: "mutable" | "sealed",
): void {
  const lifecycle = fixture.endpoint
    .context(fixture.contextId)
    ?.blocks.find((block) => block.id === blockId)?.lifecycle;
  assertEqual(lifecycle, expected, `${blockId} Session lifecycle`);
}

export function inputSnapshot(source: Terminal): InputSnapshot {
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

export function assertInputStateUnchanged(
  actual: InputSnapshot,
  expected: InputSnapshot,
  label: string,
): void {
  assertEqual(actual.text, expected.text, `${label} text`);
  assertEqual(actual.cursorX, expected.cursorX, `${label} cursor`);
  assertEqual(actual.focused, expected.focused, `${label} focus`);
}

export function copySelection(source: Terminal): string | undefined {
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

export function requiredTextarea(source: Terminal): HTMLTextAreaElement {
  if (source.textarea === undefined) {
    throw new Error("xterm did not create its input textarea.");
  }
  return source.textarea;
}

export function requiredCompositionView(source: Terminal): HTMLElement {
  const view = source.element?.querySelector<HTMLElement>(".composition-view");
  if (view === null || view === undefined) {
    throw new Error("xterm did not create its composition view.");
  }
  return view;
}

export function write(source: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => source.write(data, resolve));
}

export function nextTurn(): Promise<void> {
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

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

export function assertTrue(value: boolean, label: string): void {
  if (!value) {
    throw new Error(`${label}: expected true, received false.`);
  }
}
