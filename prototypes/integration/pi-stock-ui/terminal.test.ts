import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessageFrames } from "@tui-protocol/protocol";
import { TuiClient } from "@tui-protocol/sdk";
import { FakeHost } from "./fake-host.ts";
import { TrialTerminal } from "./terminal.ts";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function queryFrame(): Uint8Array {
  const frames = encodeMessageFrames({ version: 1, kind: "capability.query", request_id: "1", body: {} } as never, 1);
  assert.equal(frames.length, 1);
  return frames[0];
}

function setup(client?: TuiClient) {
  const host = new FakeHost();
  const received: Uint8Array[] = [];
  const failures: Error[] = [];
  const sink = client ?? { receive: (bytes: Uint8Array) => { received.push(bytes.slice()); return []; } };
  const terminal = new TrialTerminal({
    input: host.input, output: host.output, client: sink as never,
    onProtocolFailure: error => failures.push(error),
  });
  return { host, terminal, received, failures };
}

test("keystrokes reach the editor untouched and in order around a reply frame", async () => {
  const { host, terminal, received, failures } = setup();
  const piInput: string[] = [];
  terminal.start(data => piInput.push(data), () => {});
  const frame = queryFrame();
  host.send("a");
  host.send(frame);
  host.send("b");
  await delay(30);
  assert.equal(received.length, 1);
  assert.deepEqual([...received[0]], [...frame]);
  assert.equal(piInput.join(""), "ab");
  assert.deepEqual(failures, []);
  terminal.stop();
});

test("a reply frame split across chunks still reaches the client exactly once", async () => {
  const { host, terminal, received, failures } = setup();
  terminal.start(() => {}, () => {});
  const frame = queryFrame();
  host.send(frame.subarray(0, 3));
  host.send(frame.subarray(3, 40));
  host.send(frame.subarray(40));
  await delay(30);
  assert.equal(received.length, 1);
  assert.deepEqual([...received[0]], [...frame]);
  assert.deepEqual(failures, []);
  terminal.stop();
});

test("a lone Escape keypress is released to the editor after the escape timeout", async () => {
  const { host, terminal, received, failures } = setup();
  const piInput: string[] = [];
  terminal.start(data => piInput.push(data), () => {});
  host.send("\x1b");
  await delay(1);
  assert.equal(piInput.length, 0);
  assert.equal(received.length, 0);
  await delay(80);
  assert.deepEqual(piInput, ["\x1b"]);
  assert.deepEqual(failures, []);
  terminal.stop();
});

test("terminal color-query replies are ordinary input for Pi, never protocol frames", async () => {
  const { host, terminal, received, failures } = setup();
  const piInput: string[] = [];
  terminal.start(data => piInput.push(data), () => {});
  host.send("\x1b]11;rgb:0000/0000/0000\x07");
  await delay(30);
  assert.equal(piInput.join(""), "\x1b]11;rgb:0000/0000/0000\x07");
  assert.equal(received.length, 0);
  assert.deepEqual(failures, []);
  terminal.stop();
});

test("an OSC sequence that merely shares a prefix digit with 9002 stays ordinary input", async () => {
  const { host, terminal, received, failures } = setup();
  const piInput: string[] = [];
  terminal.start(data => piInput.push(data), () => {});
  host.send("\x1b]9;4;3\x07");
  await delay(30);
  assert.equal(piInput.join(""), "\x1b]9;4;3\x07");
  assert.equal(received.length, 0);
  assert.deepEqual(failures, []);
  terminal.stop();
});

test("a BEL-terminated protocol frame is a protocol failure, not editor input", async () => {
  const { host, terminal, failures } = setup(new TuiClient({ write: () => {} }));
  const piInput: string[] = [];
  terminal.start(data => piInput.push(data), () => {});
  host.send("\x1b]9002;1;1;0;0;QUJD\x07");
  await delay(30);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /ST terminator/);
  assert.equal(piInput.join(""), "");
  terminal.stop();
});

test("input typed before the UI starts is replayed to Pi in order at start", async () => {
  const { host, terminal, failures } = setup();
  terminal.attach();
  host.send("hi");
  const piInput: string[] = [];
  terminal.start(data => piInput.push(data), () => {});
  await delay(30);
  assert.equal(piInput.join(""), "hi");
  assert.deepEqual(failures, []);
  terminal.stop();
});
