import "./styled-test-env.ts";
import { bakedBreaks, compareLayout, logicalLines, renderAt, terminalRows } from "./wrap-experiment.ts";
import { WRAP_SAMPLE } from "./wrap-sample.ts";

// Prints the wrap-baking comparison: at each display width, how the terminal's
// reflow of a render taken at some width compares with Pi's own layout.
//   node prototypes/integration/pi-stock-ui/wrap-probe.ts [--rows]
const showRows = process.argv.includes("--rows");
const wide = renderAt(WRAP_SAMPLE, 1000);
console.log(`Hard breaks inserted for width: 60-column render ${bakedBreaks(renderAt(WRAP_SAMPLE, 60), wide)}, ` +
  `36-column render ${bakedBreaks(renderAt(WRAP_SAMPLE, 36), wide)}`);
console.log("render  display  rows/Pi  Pi rows kept  mid-word splits  lost prefixes");
for (const [label, renderWidth] of [["60", 60], ["wide", 1000]] as const) {
  for (const display of [60, 36, 100]) {
    const native = await terminalRows(renderAt(WRAP_SAMPLE, renderWidth), 60, ...(display === 60 ? [] : [display]));
    const pi = logicalLines(renderAt(WRAP_SAMPLE, display));
    const result = compareLayout(native, pi);
    console.log(`${label.padEnd(6)}  ${String(display).padEnd(7)}  ${`${result.rows}/${result.piRows}`.padEnd(7)}  ` +
      `${`${result.matchingRows}/${result.piRows}`.padEnd(12)}  ${String(result.midWordSplits).padEnd(15)}  ${result.lostPrefixes}`);
    if (showRows) for (const row of native) console.log(`  ${row.wrapped ? "~" : "|"}${row.text}`);
  }
}
