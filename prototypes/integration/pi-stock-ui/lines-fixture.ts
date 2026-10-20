import type { LayoutLine } from "../../line-layout/layout.ts";
import { linesFromRender } from "./lines-from-render.ts";
import { logicalLines, renderAt } from "./wrap-experiment.ts";
import { CJK_NESTED_SAMPLE, WRAP_SAMPLE } from "./wrap-sample.ts";

/** Pi's text/lines content and its own layout at fixed widths, for checks that cannot run Pi. */
export interface LinesFixture {
  readonly pi: string;
  readonly samples: Record<string, {
    readonly lines: readonly LayoutLine[];
    readonly layouts: Record<string, readonly string[]>;
  }>;
}

export const FIXTURE_WIDTHS = [36, 60] as const;

export function buildLinesFixture(): LinesFixture {
  const sample = (markdown: string) => ({
    lines: linesFromRender(renderAt(markdown, 1000)),
    layouts: Object.fromEntries(FIXTURE_WIDTHS.map(cols => [String(cols), logicalLines(renderAt(markdown, cols))])),
  });
  return { pi: "0.87.1", samples: { wrap: sample(WRAP_SAMPLE), cjk: sample(CJK_NESTED_SAMPLE) } };
}
