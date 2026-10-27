import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { formatPatchReport, installRenderGate, renderGateActive, setRenderGate, withRenderGate } from "./render-gate.ts";

const EXPECTED_CLASSES = [
  "AssistantMessageComponent", "UserMessageComponent", "ToolExecutionComponent",
  "SkillInvocationMessageComponent", "BashExecutionComponent",
  "CompactionSummaryMessageComponent", "BranchSummaryMessageComponent", "CustomMessageComponent",
];

test("the gate wraps exactly the eight transcript component render methods, once", () => {
  const first = installRenderGate();
  assert.deepEqual(first.map(entry => entry.className), EXPECTED_CLASSES);
  assert(first.every(entry => entry.method === "render" && entry.source.startsWith("modes/interactive/components/")));
  assert.equal(installRenderGate(), first);
  const report = JSON.parse(formatPatchReport(first));
  assert.equal(report.upstream, "@earendil-works/pi-coding-agent@0.87.1");
  assert.equal(report.wrapped.length, 8);
});

test("the flag flips between gated and stock behavior and defaults to stock", () => {
  installRenderGate();
  assert.equal(renderGateActive(), false);
  setRenderGate(true);
  assert.equal(renderGateActive(), true);
  setRenderGate(false);
  assert.equal(renderGateActive(), false);
});

test("a gated user-message component renders zero lines only while the gate is active", () => {
  initTheme();
  installRenderGate();
  const component = new UserMessageComponent("gate probe text");
  setRenderGate(true);
  try {
    assert.deepEqual(component.render(80), []);
  } finally {
    setRenderGate(false);
  }
  const lines = component.render(80);
  assert(lines.length > 0 && lines.some(line => line.includes("gate probe text")));
});

test("scoped gate overrides restore the previous value after nesting and failure", () => {
  installRenderGate();
  setRenderGate(true);
  try {
    const result = withRenderGate(false, () => {
      assert.equal(renderGateActive(), false);
      return withRenderGate(true, () => {
        assert.equal(renderGateActive(), true);
        return "nested";
      });
    });
    assert.equal(result, "nested");
    assert.equal(renderGateActive(), true);
    assert.throws(() => withRenderGate(false, () => { throw new Error("render failed"); }), /render failed/);
    assert.equal(renderGateActive(), true);
  } finally {
    setRenderGate(false);
  }
});

test("scoped gate selects stock and protocol component output without leaking the override", () => {
  initTheme();
  installRenderGate();
  const component = new UserMessageComponent("paired gate probe");
  setRenderGate(true);
  try {
    const stock = withRenderGate(false, () => component.render(80));
    assert(stock.length > 0 && stock.some(line => line.includes("paired gate probe")));
    assert.equal(renderGateActive(), true);
    assert.deepEqual(withRenderGate(true, () => component.render(80)), []);
    assert.equal(renderGateActive(), true);
  } finally {
    setRenderGate(false);
  }
});
