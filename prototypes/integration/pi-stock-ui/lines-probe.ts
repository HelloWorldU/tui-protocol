import "./styled-test-env.ts";
import { layoutLines, rowText } from "../../line-layout/layout.ts";
import { linesFromRender, splitLines } from "./lines-from-render.ts";
import { renderAt } from "./wrap-experiment.ts";
import { WRAP_SAMPLE } from "./wrap-sample.ts";

// Prints, per width, the rows where the line-layout engine's rows differ from
// Pi's own render: text first, then styles.
const lines = linesFromRender(renderAt(WRAP_SAMPLE, 1000));
for (const cols of [36, 60, 100]) {
  const ours = layoutLines(lines, cols);
  const pi = splitLines(renderAt(WRAP_SAMPLE, cols));
  const textDiffs = [];
  const styleDiffs = [];
  for (let index = 0; index < Math.max(ours.length, pi.length); index++) {
    const mine = ours[index];
    const theirs = pi[index] ?? [];
    const mineText = mine === undefined ? "<none>" : rowText(mine);
    const theirsText = theirs.map(span => span.text).join("");
    if (mineText !== theirsText) textDiffs.push(`  ${index}: ours ${JSON.stringify(mineText)}\n      pi   ${JSON.stringify(theirsText)}`);
    else if (JSON.stringify(mine?.spans) !== JSON.stringify(theirs)) styleDiffs.push(`  ${index}: ${JSON.stringify(mine?.spans)}\n      pi ${JSON.stringify(theirs)}`);
  }
  console.log(`=== ${cols} columns: ${ours.length} rows vs Pi ${pi.length}; text diffs ${textDiffs.length}, style-only diffs ${styleDiffs.length}`);
  for (const line of [...textDiffs, ...styleDiffs]) console.log(line);
}
