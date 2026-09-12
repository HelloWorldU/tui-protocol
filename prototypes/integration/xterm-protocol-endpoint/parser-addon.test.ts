import assert from "node:assert/strict";
import test from "node:test";

import headless from "@xterm/headless";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";

import {
  ProtocolStreamDecoder,
  encodeMessageFrames,
  type Message,
} from "../../../protocol/src/index.ts";
import type { EndpointDiagnostic } from "../../../terminal/src/index.ts";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import { XtermProtocolParserAddon } from "./parser-addon.ts";

const { Terminal } = headless;

test("xterm shows startup text, hides a split OSC 9002 query, emits Capability and Context responses, and renders Append followed by Update", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const responseFrames: Uint8Array[] = [];
  const diagnostics: EndpointDiagnostic[] = [];
  const addon = new XtermProtocolParserAddon(endpoint, {
    onResponseFrame: (frame) => responseFrames.push(frame),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  xterm.loadAddon(addon);

  await write(xterm, "shell ready\r\n");

  const capability = encodeInput(
    {
      version: 1,
      kind: "capability.query",
      request_id: "capability-1",
      body: {},
    },
    1,
  );
  const splitAt = Math.floor(capability.length / 2);
  await write(xterm, capability.subarray(0, splitAt));
  assert.deepEqual(responseFrames, []);
  await write(xterm, capability.subarray(splitAt));

  assert.deepEqual(takeResponses(responseFrames), [
    {
      version: 1,
      kind: "capability.response",
      request_id: "capability-1",
      body: { outcome: "supported", optional_content_types: [] },
    },
  ]);

  await write(
    xterm,
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
  const [opened] = takeResponses(responseFrames);
  assert.equal(opened?.kind, "context.open.response");
  if (opened?.kind !== "context.open.response" || !("context_id" in opened)) {
    throw new Error("Expected a successful Context open response.");
  }

  await write(
    xterm,
    concatenate([
      encodeInput(
        {
          version: 1,
          kind: "block.append",
          operation_id: "1",
          context_id: opened.context_id,
          body: {
            block_id: "thinking",
            lifecycle: "mutable",
            content: { type: "text/plain", data: "draft" },
          },
        },
        3,
      ),
      encodeInput(
        {
          version: 1,
          kind: "block.update",
          operation_id: "2",
          context_id: opened.context_id,
          body: {
            block_id: "thinking",
            content: { type: "text/plain", data: "complete" },
          },
        },
        4,
      ),
    ]),
  );
  await addon.drain();

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(responseFrames, []);
  assert.equal(
    endpoint.context(opened.context_id)?.blocks[0]?.content.data,
    "complete",
  );
  assert.deepEqual(bufferRows(xterm), ["shell ready", "complete", ""]);
  assert.equal(bufferText(xterm).includes("]9002;"), false);

  addon.dispose();
  endpoint.dispose();
  xterm.dispose();
});

test("an invalid OSC 9002 payload reports a framing diagnostic and later ordinary output remains visible", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const diagnostics: EndpointDiagnostic[] = [];
  const addon = new XtermProtocolParserAddon(endpoint, {
    onResponseFrame: () => assert.fail("Invalid framing must not respond."),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  xterm.loadAddon(addon);

  await write(xterm, "\u001B]9002;not-a-frame\u001B\\");
  await write(xterm, "still visible\r\n");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.layer, "framing");
  assert.equal(bufferText(xterm).includes("still visible"), true);
  assert.equal(bufferText(xterm).includes("not-a-frame"), false);

  addon.dispose();
  endpoint.dispose();
  xterm.dispose();
});

function createTerminal(): InstanceType<typeof Terminal> {
  return new Terminal({
    allowProposedApi: true,
    cols: 20,
    rows: 3,
    scrollback: 100,
  });
}

function write(
  terminal: HeadlessTerminal,
  data: string | Uint8Array,
): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function encodeInput(message: Message, frameId: number): Uint8Array {
  return concatenate(encodeMessageFrames(message, frameId));
}

function takeResponses(frames: Uint8Array[]): readonly Message[] {
  const decoder = new ProtocolStreamDecoder();
  const events = frames.splice(0).flatMap((frame) => decoder.push(frame));
  assert.ok(events.every((event) => event.type === "message"));
  return events.flatMap((event) =>
    event.type === "message" ? [event.message] : [],
  );
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

function bufferText(terminal: HeadlessTerminal): string {
  return bufferRows(terminal).join("\n");
}

function bufferRows(terminal: HeadlessTerminal): string[] {
  const rows: string[] = [];
  for (let index = 0; index < terminal.buffer.active.length; index += 1) {
    rows.push(
      terminal.buffer.active.getLine(index)?.translateToString(true) ?? "",
    );
  }
  return rows;
}
