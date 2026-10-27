import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { connectChannel } from "./channel-client.ts";
import { FakeInput, FakeOutput } from "./fake-host.ts";
import { PairHost, type FrontendRole } from "./pair-transport.ts";

async function waitFor(predicate: () => boolean, reason: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${reason}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("both roles start once and exchange output, protocol input, and PTY dimensions", async () => {
  const ready: string[] = [];
  const inputs: string[] = [];
  const resizes: Array<{ role: FrontendRole; columns: number; rows: number }> = [];
  const host = new PairHost({
    port: 0,
    token: "fixture-token",
    onReady: () => { ready.push("ready"); },
    onInput: data => inputs.push(Buffer.from(data).toString()),
    onResize: (role, columns, rows) => resizes.push({ role, columns, rows }),
  });
  const { port, token } = await host.start();
  const stockInput = new FakeInput();
  const protocolInput = new FakeInput();
  const stockOutput = new FakeOutput();
  const protocolOutput = new FakeOutput();
  const stock = connectChannel({
    role: "stock",
    url: `ws://127.0.0.1:${port}/?role=stock&token=${token}`,
    input: stockInput,
    output: stockOutput,
  });
  const protocol = connectChannel({
    role: "protocol",
    url: `ws://127.0.0.1:${port}/?role=protocol&token=${token}`,
    input: protocolInput,
    output: protocolOutput,
  });
  try {
    await Promise.all([stock.ready, protocol.ready, host.ready]);
    assert.deepEqual(ready, ["ready"]);
    const stockChunks: Buffer[] = [];
    const protocolChunks: Buffer[] = [];
    stockOutput.on("data", chunk => stockChunks.push(chunk));
    protocolOutput.on("data", chunk => protocolChunks.push(chunk));
    host.send("stock", Buffer.from("stock bytes"));
    host.send("protocol", Buffer.from("protocol bytes"));
    await waitFor(() => stockChunks.length === 1 && protocolChunks.length === 1, "both frontend outputs");
    assert.equal(stockChunks[0].toString(), "stock bytes");
    assert.equal(protocolChunks[0].toString(), "protocol bytes");

    protocolInput.write("hello");
    await waitFor(() => inputs.includes("hello"), "protocol input to reach the host");
    stockInput.write("must not be forwarded");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(inputs, ["hello"]);

    stockOutput.columns = 36;
    stockOutput.rows = 24;
    stockOutput.emit("resize");
    protocolOutput.columns = 60;
    protocolOutput.rows = 30;
    protocolOutput.emit("resize");
    await waitFor(() => resizes.length === 2, "both frontend resize events");
    assert.deepEqual(resizes, [
      { role: "stock", columns: 36, rows: 24 },
      { role: "protocol", columns: 60, rows: 30 },
    ]);
  } finally {
    await Promise.all([stock.close(), protocol.close(), host.close()]);
  }
});

test("an invalid token or role never starts the paired UI", async () => {
  let ready = 0;
  const host = new PairHost({
    port: 0,
    token: "expected-token",
    onReady: () => { ready += 1; },
    onInput: () => { throw new Error("unexpected input"); },
    onResize: () => {},
  });
  const { port } = await host.start();
  const invalid = connectChannel({
    role: "stock",
    url: `ws://127.0.0.1:${port}/?role=stock&token=wrong-token`,
    input: new FakeInput(),
    output: new FakeOutput(),
  });
  await assert.rejects(invalid.ready);
  assert.equal(ready, 0);

  const wrongRole = new WebSocket(`ws://127.0.0.1:${port}/?role=other&token=expected-token`);
  await new Promise<void>(resolve => {
    wrongRole.on("open", () => wrongRole.close());
    wrongRole.on("close", () => resolve());
  });
  assert.equal(ready, 0);

  const stock = connectChannel({
    role: "stock",
    url: `ws://127.0.0.1:${port}/?role=stock&token=expected-token`,
    input: new FakeInput(),
    output: new FakeOutput(),
  });
  const protocol = connectChannel({
    role: "protocol",
    url: `ws://127.0.0.1:${port}/?role=protocol&token=expected-token`,
    input: new FakeInput(),
    output: new FakeOutput(),
  });
  try {
    await Promise.all([stock.ready, protocol.ready, host.ready]);
    assert.equal(ready, 1);
  } finally {
    await Promise.all([stock.close(), protocol.close(), host.close()]);
  }
});
