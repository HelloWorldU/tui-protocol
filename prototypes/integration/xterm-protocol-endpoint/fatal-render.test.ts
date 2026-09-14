import assert from "node:assert/strict";
import test from "node:test";
import type { Operation } from "../../block-model/model.ts";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import { XtermMixedStreamIngress } from "./mixed-ingress.ts";
import {
  append, bufferRows, concatenate, createTerminal, encodeInput, extend,
  negotiateAndOpen, text, update,
} from "./test-support.ts";

for (const mixed of [false, true]) {
  test(`${mixed ? "mixed ingress" : "protocol endpoint"} stops queued rendering and rejects reuse after a renderer writes partial output then throws`, async () => {
    const terminal = createTerminal();
    const fault = new Error("Injected failure after partial native output");
    let armed = false;
    const rendered: string[] = [];
    class FaultHistory extends PrivateCoreBlockHistory {
      override async renderAccepted(operation: Operation): Promise<void> {
        rendered.push(operation.type);
        if (armed && operation.type === "update") {
          await new Promise<void>(resolve => terminal.write("partial", resolve));
          throw fault;
        }
        await super.renderAccepted(operation);
      }
    }
    const endpoint = new XtermProtocolEndpoint(terminal, {
      completeBaselineSupported: true, history: new FaultHistory(terminal),
    });
    const responses: Uint8Array[] = [];
    const ingress = new XtermMixedStreamIngress(terminal, endpoint, {
      onResponseFrame: frame => responses.push(frame), onDiagnostic: () => {},
    });
    try {
      // Each fixture uses one input path throughout setup and the fault.
      let context: string;
      if (mixed) {
        await ingress.push(concatenate([
          encodeInput({ version: 1, kind: "capability.query", request_id: "c", body: {} }, 1),
          encodeInput({ version: 1, kind: "context.open", request_id: "o", body: {} }, 2),
        ]));
        context = endpoint.contexts()[0]!.id;
        responses.length = 0;
        await ingress.push(encodeInput(append(context, "1", "a", "old"), 3));
      } else {
        context = negotiateAndOpen(endpoint);
        endpoint.push(encodeInput(append(context, "1", "a", "old"), 3));
        await endpoint.drain();
      }
      rendered.length = 0;
      armed = true;
      const bytes = concatenate([
        encodeInput(update(context, "2", "a", "new"), 4),
        encodeInput(extend(context, "3", "a", "2", " later"), 5),
        ...(mixed ? [text("UNREACHED")] : []),
      ]);
      if (mixed) {
        const first = ingress.push(bytes);
        const queued = ingress.push(encodeInput({
          version: 1, kind: "context.close", request_id: "close", context_id: context, body: {},
        }, 6));
        const results = await Promise.allSettled([first, queued]);
        assert.ok(results.every(result => result.status === "rejected"));
        assert.equal(endpoint.context(context)?.blocks[0]?.content.data, "new");
        await assert.rejects(ingress.finish(), /Injected failure/);
        assert.deepEqual(responses, []); // Neither ordinary internal_error nor close success.
      } else {
        endpoint.push(bytes);
        await assert.rejects(endpoint.drain(), /Injected failure/);
        // Protocol-only batching may commit later logical state before rendering.
        assert.equal(endpoint.context(context)?.blocks[0]?.content.data, "new later");
      }
      assert.deepEqual(rendered, ["update"]);
      assert.ok(bufferRows(terminal).includes("partial"));
      assert.ok(!bufferRows(terminal).join("\n").includes("UNREACHED"));
      const snapshot = endpoint.context(context);
      const savedRows = bufferRows(terminal);
      assert.throws(() => endpoint.push(encodeInput({
        version: 1, kind: "context.open", request_id: "new-context", body: {},
      }, 7)), /Protocol execution stopped/);
      assert.throws(() => endpoint.finish(), /Protocol execution stopped/);
      assert.deepEqual(endpoint.context(context), snapshot);
      assert.equal(snapshot?.blocks[0]?.lifecycle, "mutable");
      assert.deepEqual(bufferRows(terminal), savedRows);
      const replacementIngress = new XtermMixedStreamIngress(terminal, endpoint, {
        onResponseFrame: () => assert.fail("aborted session emitted a response"),
        onDiagnostic: () => {},
      });
      try {
        await assert.rejects(replacementIngress.push(text("UNREACHED")), /Injected failure/);
        assert.deepEqual(bufferRows(terminal), savedRows);
      } finally { replacementIngress.dispose(); }
      const otherTerminal = createTerminal();
      const other = new XtermProtocolEndpoint(otherTerminal, { completeBaselineSupported: true });
      try { assert.ok(negotiateAndOpen(other)); } finally { other.dispose(); otherTerminal.dispose(); }
    } finally {
      ingress.dispose(); endpoint.dispose(); terminal.dispose();
    }
  });
}
