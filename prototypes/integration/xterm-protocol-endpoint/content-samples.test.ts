import assert from "node:assert/strict";
import test from "node:test";
import { contentSamples, unsupportedTabSamples } from "./content-samples.ts";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import { createTerminal, negotiateAndOpen, encodeInput, append, update, extend, decodeResponses, bufferRows } from "./test-support.ts";

for (const sample of contentSamples) test(`${sample.name} survives Append and full replacement as native Buffer text`, async () => {
  const terminal = createTerminal({ cols: 40, rows: 8, scrollback: 100 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const id = negotiateAndOpen(endpoint);
    assert.deepEqual(decodeResponses(endpoint.push(encodeInput(append(id, "1", "sample", sample.text), 3))), []);
    await endpoint.drain();
    const native = () => { const range = endpoint.range(id, "sample")!; return bufferRows(terminal).slice(range.start, range.start + range.lineCount).join(""); };
    assert.equal(native(), sample.expected);
    assert.deepEqual(decodeResponses(endpoint.push(encodeInput(update(id, "2", "sample", sample.text + "!"), 4))), []);
    await endpoint.drain(); assert.equal(native(), sample.expected + "!");
    assert.equal(endpoint.context(id)?.blocks[0]?.content.data, sample.text + "!");
  } finally { endpoint.dispose(); terminal.dispose(); }
});

for (const sample of unsupportedTabSamples) test(`unmapped Unicode beside Tab (${JSON.stringify(sample)}) is rejected before rows or the old base change`, async () => {
  const terminal = createTerminal({ cols: 40, rows: 8 }); const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const id = negotiateAndOpen(endpoint); endpoint.push(encodeInput(append(id, "1", "sample", "old"), 3)); await endpoint.drain();
    const rows = bufferRows(terminal);
    const [response] = decodeResponses(endpoint.push(encodeInput(update(id, "2", "sample", sample), 4)));
    assert(response?.kind === "protocol.error"); assert.equal(response.body.code, "resource_exhausted");
    await endpoint.drain(); assert.deepEqual(bufferRows(terminal), rows);
    assert.equal(endpoint.context(id)?.blocks[0]?.content.data, "old");
    assert.deepEqual(decodeResponses(endpoint.push(encodeInput(extend(id, "3", "sample", "1", "!"), 5))), []);
    await endpoint.drain(); assert.equal(endpoint.context(id)?.blocks[0]?.content.data, "old!");
  } finally { endpoint.dispose(); terminal.dispose(); }
});
