import assert from "node:assert/strict";
import test from "node:test";
import { hasStreamingAssistantText } from "./live-cancel-check.ts";

test("the armed browser check waits for nonempty mutable assistant text, not tools, empty labels, or completed answers", () => {
  const line = (state: string, text: string) => `  pi-4: ${state}; ${JSON.stringify(text)}`;
  for (const report of ["No Contexts", line("mutable", "Assistant:\n"), line("mutable", "Tool: read\ntext"),
    line("sealed", "Assistant:\nfinished"), '  pi-4: mutable; "malformed']) {
    assert.equal(hasStreamingAssistantText(report), false);
  }
  assert(hasStreamingAssistantText(`Context context-1: open\n${line("mutable", "Assistant:\nTrial sample: 中文")}`));
});
