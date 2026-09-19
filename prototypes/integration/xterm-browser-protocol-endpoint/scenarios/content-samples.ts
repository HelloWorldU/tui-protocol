import { contentSamples } from "../../xterm-protocol-endpoint/content-samples.ts";
import { append, update, createFixture, pushMessages, requiredRange, assertEqual, type ScenarioResult } from "../scenario-harness.ts";

export async function runContentSampleScenarios(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const sample of contentSamples) {
    const f = createFixture({ cols: 40, rows: 8, scrollback: 100 });
    try {
      pushMessages(f.endpoint, [append(f.contextId, "1", "sample", sample.text, "mutable")]); await f.endpoint.drain();
      const native = () => {
        const range = requiredRange(f, "sample");
        return Array.from({ length: range.lineCount }, (_, row) => f.terminal.buffer.normal.getLine(range.start + row)?.translateToString(true) ?? "").join("");
      };
      assertEqual(native(), sample.expected, "browser Buffer text after Append");
      f.endpoint.resize(20, 8); assertEqual(native(), sample.expected, "browser Buffer text after narrowing");
      f.endpoint.resize(40, 8); assertEqual(native(), sample.expected, "browser Buffer text after widening");
      pushMessages(f.endpoint, [update(f.contextId, "2", "sample", sample.text + "!")]); await f.endpoint.drain();
      assertEqual(native(), sample.expected + "!", "browser Buffer text after Update");
      results.push({ name: `Trial content: ${sample.name}`, detail: "native Buffer text survived Append, 40–20–40 resize, and Update; this check does not assert glyph shaping or Unicode selection mapping" });
    } finally { f.dispose(); }
  }
  return results;
}
