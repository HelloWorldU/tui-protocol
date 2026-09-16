import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { TuiClient } from "@tui-protocol/sdk";
import type { Operation } from "../../block-model/model.ts";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";
import { XtermProtocolEndpoint, XtermMixedStreamIngress } from "../xterm-protocol-endpoint/index.ts";
import { bufferRows, createTerminal } from "../xterm-protocol-endpoint/test-support.ts";

export interface PressureResult {
  extensions: number;
  batchSize: number;
  submittedBytes: number;
  peakUnsettledPushes: number;
  peakUnsettledBytes: number;
  held: { unsettledPushes: number; unsettledBytes: number; started: number; completed: number };
  completed: number;
  remainingPushes: number;
  remainingBytes: number;
}

function barrier() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Fixture accounting, not heap measurement or a public transport metric API. */
export async function measurePressure(extensions: number, batchSize: number): Promise<PressureResult> {
  assert.ok(Number.isInteger(extensions) && extensions >= 1 && extensions <= 256);
  assert.ok(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= extensions);
  const terminal = createTerminal({ cols: 80, rows: 8, scrollback: 1000 });
  const entered = barrier();
  const resume = barrier();
  // A broken fixture must fail instead of hanging indefinitely at the barrier.
  const deadline = setTimeout(() => {
    const error = new Error("Pressure fixture did not release its render barrier within 10 seconds");
    entered.reject(error); resume.reject(error);
  }, 10_000);
  void entered.promise.catch(() => {});
  void resume.promise.catch(() => {});
  let started = 0;
  let completed = 0;
  class GatedHistory extends PrivateCoreBlockHistory {
    override async renderAccepted(operation: Operation): Promise<void> {
      if (operation.type === "extend") {
        started++;
        if (started === 1) { entered.resolve(); await resume.promise; }
      }
      await super.renderAccepted(operation);
      if (operation.type === "extend") completed++;
    }
  }
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true, history: new GatedHistory(terminal),
  });
  let measuring = false;
  let unsettledPushes = 0;
  let unsettledBytes = 0;
  let peakUnsettledPushes = 0;
  let peakUnsettledBytes = 0;
  let submittedBytes = 0;
  let tail = Promise.resolve();
  const client = new TuiClient({
    // The real SDK writes synchronously. Only this in-process producer can wait
    // on local ingress completion; this is NOT an Operation acknowledgement.
    write(bytes) {
      const counted = measuring;
      const size = bytes.length;
      if (counted) {
        unsettledPushes++; unsettledBytes += size; submittedBytes += size;
        peakUnsettledPushes = Math.max(peakUnsettledPushes, unsettledPushes);
        peakUnsettledBytes = Math.max(peakUnsettledBytes, unsettledBytes);
      }
      tail = ingress.push(bytes).finally(() => {
        if (counted) { unsettledPushes--; unsettledBytes -= size; }
      });
      // Attach a handler immediately even when a burst does not await each push.
      void tail.catch(() => {});
    },
  });
  const ingress = new XtermMixedStreamIngress(terminal, endpoint, {
    onResponseFrame(frame) {
      for (const event of client.receive(frame)) {
        assert.notEqual(event.type, "error");
        if (event.type === "message") assert.notEqual(event.message.kind, "protocol.error");
      }
    },
    onDiagnostic(diagnostic) { assert.fail(diagnostic.reason); },
  });
  let producing: Promise<void> | undefined;
  try {
    assert.equal(await client.negotiate(), true);
    const context = await client.openContext();
    let base = context.append("stream", "Start", "mutable");
    await tail;
    const fragments = Array.from({ length: extensions }, (_, index) =>
      `\nfragment-${String(index + 1).padStart(3, "0")}`);
    measuring = true;
    producing = (async () => {
      for (let index = 0; index < fragments.length; index++) {
        base = context.extend("stream", base, fragments[index]!);
        if ((index + 1) % batchSize === 0) await tail;
      }
      await tail;
    })();
    void producing.catch(error => entered.reject(error));
    await entered.promise;
    const held = { unsettledPushes, unsettledBytes, started, completed };
    assert.equal(held.unsettledPushes, Math.min(batchSize, extensions));
    assert.equal(held.started, 1);
    assert.equal(held.completed, 0);
    // Only the first Extend has reached Session commit; no fragment has rendered.
    assert.equal(endpoint.context(context.id)?.blocks[0]?.content.data, `Start${fragments[0]}`);
    assert.ok(!bufferRows(terminal).some(row => row.includes("fragment-")));
    resume.resolve();
    clearTimeout(deadline);
    await producing;
    measuring = false;
    assert.equal(completed, extensions);
    assert.equal(unsettledPushes, 0); assert.equal(unsettledBytes, 0);
    const expected = `Start${fragments.join("")}`;
    assert.equal(endpoint.context(context.id)?.blocks[0]?.content.data, expected);
    const range = endpoint.range(context.id, "stream");
    assert.ok(range);
    assert.deepEqual(bufferRows(terminal).slice(range.start, range.start + range.lineCount), expected.split("\n"));

    context.seal("stream");
    await tail;
    await ingress.push(new TextEncoder().encode("DONE\r\n"));
    await context.close(); await tail; await ingress.finish();
    assert.equal(endpoint.context(context.id)?.state, "closed");
    assert.equal(endpoint.context(context.id)?.blocks[0]?.lifecycle, "sealed");
    assert.equal(bufferRows(terminal).filter(row => row === "DONE").length, 1);
    return { extensions, batchSize, submittedBytes, peakUnsettledPushes, peakUnsettledBytes,
      held, completed, remainingPushes: unsettledPushes, remainingBytes: unsettledBytes };
  } finally {
    clearTimeout(deadline); resume.resolve();
    await producing?.catch(() => {});
    await tail.catch(() => {});
    client.dispose(); ingress.dispose(); endpoint.dispose(); terminal.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results: PressureResult[] = [];
  for (const extensions of [16, 64, 256]) {
    for (const batchSize of [extensions, 8, 1]) results.push(await measurePressure(extensions, batchSize));
  }
  console.log(JSON.stringify({ scope: "in-process SDK to headless mixed ingress; controlled first-Extend stall", results }, null, 2));
}
