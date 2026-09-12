import assert from "node:assert/strict";

import headless from "@xterm/headless";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";

import {
  ProtocolStreamDecoder,
  encodeMessageFrames,
  type Message,
} from "../../../protocol/src/index.ts";
import type {
  EndpointDiagnostic,
  EndpointResult,
} from "../../../terminal/src/index.ts";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import { XtermMixedStreamIngress } from "./mixed-ingress.ts";

const { Terminal } = headless;

export interface TerminalOptions {
  readonly cols?: number;
  readonly rows?: number;
  readonly scrollback?: number;
}

export interface MixedFixture {
  readonly terminal: InstanceType<typeof Terminal>;
  readonly endpoint: XtermProtocolEndpoint;
  readonly ingress: XtermMixedStreamIngress;
  readonly responseFrames: Uint8Array[];
  readonly diagnostics: EndpointDiagnostic[];
  dispose(): void;
}

export function createTerminal(
  options: TerminalOptions = {},
): InstanceType<typeof Terminal> {
  return new Terminal({
    allowProposedApi: true,
    cols: options.cols ?? 10,
    rows: options.rows ?? 3,
    scrollback: options.scrollback ?? 100,
  });
}

export function createMixedFixture(
  options: TerminalOptions = {},
): MixedFixture {
  const terminal = createTerminal({
    cols: options.cols ?? 20,
    rows: options.rows ?? 5,
    scrollback: options.scrollback ?? 100,
  });
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true,
  });
  const responseFrames: Uint8Array[] = [];
  const diagnostics: EndpointDiagnostic[] = [];
  const ingress = new XtermMixedStreamIngress(terminal, endpoint, {
    onResponseFrame: (frame) => responseFrames.push(frame),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return {
    terminal,
    endpoint,
    ingress,
    responseFrames,
    diagnostics,
    dispose: () => {
      ingress.dispose();
      endpoint.dispose();
      terminal.dispose();
    },
  };
}

export function negotiateAndOpen(endpoint: XtermProtocolEndpoint): string {
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
  assert.deepEqual(decodeResponses(capability), [
    {
      version: 1,
      kind: "capability.response",
      request_id: "capability-1",
      body: { outcome: "supported", optional_content_types: [] },
    },
  ]);

  return openEndpointContext(endpoint, "open-1", 2);
}

export function openEndpointContext(
  endpoint: XtermProtocolEndpoint,
  requestId: string,
  frameId: number,
): string {
  const opened = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "context.open",
        request_id: requestId,
        body: {},
      },
      frameId,
    ),
  );
  const [response] = decodeResponses(opened);
  assert.equal(response?.kind, "context.open.response");
  if (response?.kind !== "context.open.response" || !("context_id" in response)) {
    throw new Error("Expected a successful Context open response.");
  }
  return response.context_id;
}

export async function openMixedContext(fixture: MixedFixture): Promise<string> {
  await fixture.ingress.push(
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
  assert.equal(takeResponses(fixture.responseFrames)[0]?.kind, "capability.response");

  return openAdditionalMixedContext(fixture, "open-1", 2);
}

export async function openAdditionalMixedContext(
  fixture: MixedFixture,
  requestId: string,
  frameId: number,
): Promise<string> {
  await fixture.ingress.push(
    encodeInput(
      {
        version: 1,
        kind: "context.open",
        request_id: requestId,
        body: {},
      },
      frameId,
    ),
  );
  const [response] = takeResponses(fixture.responseFrames);
  if (
    response?.kind !== "context.open.response" ||
    !("context_id" in response)
  ) {
    throw new Error("Expected a successful Context open response.");
  }
  return response.context_id;
}

export async function closeMixedContext(
  fixture: MixedFixture,
  contextId: string,
  requestId: string,
  frameId: number,
): Promise<void> {
  await fixture.ingress.push(
    encodeInput(
      {
        version: 1,
        kind: "context.close",
        request_id: requestId,
        context_id: contextId,
        body: {},
      },
      frameId,
    ),
  );
  assert.deepEqual(takeResponses(fixture.responseFrames), [
    {
      version: 1,
      kind: "context.close.response",
      request_id: requestId,
      context_id: contextId,
      body: { outcome: "closed" },
    },
  ]);
}

export function append(
  contextId: string,
  operationId: string,
  blockId: string,
  content: string,
  lifecycle: "mutable" | "sealed" = "mutable",
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

export function encodeInput(message: Message, frameId: number): Uint8Array {
  return concatenate(encodeMessageFrames(message, frameId));
}

export function decodeResponses(result: EndpointResult): readonly Message[] {
  const decoder = new ProtocolStreamDecoder();
  const events = result.responseFrames.flatMap((frame) => decoder.push(frame));
  assert.ok(events.every((event) => event.type === "message"));
  return events.flatMap((event) =>
    event.type === "message" ? [event.message] : [],
  );
}

export function takeResponses(frames: Uint8Array[]): readonly Message[] {
  const decoder = new ProtocolStreamDecoder();
  const events = frames.splice(0).flatMap((frame) => decoder.push(frame));
  assert.ok(events.every((event) => event.type === "message"));
  return events.flatMap((event) =>
    event.type === "message" ? [event.message] : [],
  );
}

export function requiredRange(
  endpoint: XtermProtocolEndpoint,
  contextId: string,
  blockId: string,
): { readonly start: number; readonly lineCount: number } {
  const range = endpoint.range(contextId, blockId);
  assert.ok(range);
  return range;
}

export function emptyResult(): EndpointResult {
  return { responseFrames: [], diagnostics: [] };
}

export function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function write(
  terminal: HeadlessTerminal,
  data: string,
): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

export function viewportTopText(terminal: HeadlessTerminal): string {
  return (
    terminal.buffer.active
      .getLine(terminal.buffer.active.viewportY)
      ?.translateToString(true) ?? ""
  );
}

export function viewportRows(terminal: HeadlessTerminal): string[] {
  const rows: string[] = [];
  for (
    let index = terminal.buffer.active.viewportY;
    index < terminal.buffer.active.viewportY + terminal.rows;
    index += 1
  ) {
    rows.push(
      terminal.buffer.active.getLine(index)?.translateToString(true) ?? "",
    );
  }
  return rows;
}

export function bufferRows(terminal: HeadlessTerminal): string[] {
  const rows: string[] = [];
  for (let index = 0; index < terminal.buffer.active.length; index += 1) {
    rows.push(
      terminal.buffer.active.getLine(index)?.translateToString(true) ?? "",
    );
  }
  return rows;
}
