import {
  AssistantMessageComponent, BashExecutionComponent, BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent, CustomMessageComponent, SkillInvocationMessageComponent,
  ToolExecutionComponent, UserMessageComponent,
} from "@earendil-works/pi-coding-agent";

/**
 * Trial render gate for Pi 0.87.1 (commit 2b0a123). When active, the transcript
 * component classes render zero lines so the terminal's Block adapter is the only
 * writer of transcript rows; chrome classes are never wrapped. When inactive,
 * every wrapped method delegates to the original, keeping Pi byte-for-byte stock.
 * The wrapped-method list is the trial's patch report against the pin.
 */
export interface PatchReportEntry {
  readonly className: string;
  readonly method: "render";
  readonly source: string;
}

type RenderMethod = (this: object, width: number) => string[];
interface ComponentClass { readonly name: string; readonly prototype: object }

const TARGETS: readonly { readonly ctor: ComponentClass; readonly source: string }[] = [
  { ctor: AssistantMessageComponent, source: "modes/interactive/components/assistant-message.ts" },
  { ctor: UserMessageComponent, source: "modes/interactive/components/user-message.ts" },
  { ctor: ToolExecutionComponent, source: "modes/interactive/components/tool-execution.ts" },
  { ctor: SkillInvocationMessageComponent, source: "modes/interactive/components/skill-invocation-message.ts" },
  { ctor: BashExecutionComponent, source: "modes/interactive/components/bash-execution.ts" },
  { ctor: CompactionSummaryMessageComponent, source: "modes/interactive/components/compaction-summary-message.ts" },
  { ctor: BranchSummaryMessageComponent, source: "modes/interactive/components/branch-summary-message.ts" },
  { ctor: CustomMessageComponent, source: "modes/interactive/components/custom-message.ts" },
];

let active = false;
let installed: PatchReportEntry[] | undefined;

/** The gate flips behavior only when the trial negotiated protocol support. */
export function renderGateActive(): boolean {
  return active;
}

export function setRenderGate(value: boolean): void {
  active = value;
}

/**
 * Wrap `render` on each transcript component class exactly once. Returns the
 * patch report; the list is also the evidence that no other class was touched.
 */
export function installRenderGate(): readonly PatchReportEntry[] {
  if (installed) return installed;
  const report: PatchReportEntry[] = [];
  for (const { ctor, source } of TARGETS) {
    const proto = ctor.prototype as Record<PropertyKey, unknown>;
    const original = typeof proto.render === "function" ? proto.render as RenderMethod : undefined;
    if (original === undefined) throw new Error(`${ctor.name} has no render method to gate at the pin`);
    if ((original as { gatedByTrial?: boolean }).gatedByTrial === true) {
      throw new Error(`${ctor.name}.render was already gated; installRenderGate must run once`);
    }
    const gated = function (this: object, width: number): string[] {
      return active ? [] : original.call(this, width);
    } as RenderMethod & { gatedByTrial: boolean };
    gated.gatedByTrial = true;
    proto.render = gated;
    report.push({ className: ctor.name, method: "render", source });
  }
  installed = report;
  return report;
}

/** Structured patch report for the console and the README record. */
export function formatPatchReport(entries: readonly PatchReportEntry[]): string {
  return JSON.stringify({
    upstream: "@earendil-works/pi-coding-agent@0.87.1",
    commit: "2b0a123",
    patch: "prototype.render wrap; zero lines when the trial render gate is active, stock otherwise",
    wrapped: entries,
  }, null, 2);
}
