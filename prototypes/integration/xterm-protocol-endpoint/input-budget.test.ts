import assert from "node:assert/strict";
import test from "node:test";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import { XtermMixedStreamIngress } from "./mixed-ingress.ts";
import { createTerminal, bufferRows, text } from "./test-support.ts";

for (const limit of ["bytes", "pushes"]) {
  test(`mixed ingress ${limit} overflow stops queued input before it reaches the renderer`, async () => {
    const terminal = createTerminal(); const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
    const ingress = new XtermMixedStreamIngress(terminal, endpoint, { pendingInputLimits: { bytes: 4, pushes: 1 }, onResponseFrame() {}, onDiagnostic() {} });
    try {
      const first = ingress.push(text("test"));
      const rejected = assert.rejects(first, /budget exhausted/);
      assert.throws(() => ingress.push(text(limit === "bytes" ? "x" : "")), /budget exhausted/);
      await rejected; assert(!bufferRows(terminal).join("").includes("test"));
      assert.throws(() => ingress.push(text("later")), /after finish/);
    } finally { ingress.dispose(); endpoint.dispose(); terminal.dispose(); }
  });
}

test("settled mixed input releases its budget for the next push", async () => {
  const terminal = createTerminal(); const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  const ingress = new XtermMixedStreamIngress(terminal, endpoint, { pendingInputLimits: { bytes: 4, pushes: 1 }, onResponseFrame() {}, onDiagnostic() {} });
  try { await ingress.push(text("abcd")); await ingress.push(text("efgh")); assert(bufferRows(terminal).join("").includes("abcdefgh")); }
  finally { ingress.dispose(); endpoint.dispose(); terminal.dispose(); }
});
