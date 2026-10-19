// Records one stock Pi turn's raw terminal output through bundled ConPTY as an
// ANSI fixture for the SDK's spansFromAnsi tests. Stock mode (trial flag off)
// so Pi draws its own styled transcript; the markdown demo text supplies bold,
// heading, list, and inline-code styling. The temp working directory is
// replaced by a placeholder so no machine path lands in the fixture.
//
//   node prototypes/integration/pi-stock-ui/record-ansi.ts <output-file>
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";

const target = process.argv[2];
if (target === undefined) throw new Error("Usage: record-ansi.ts <output-file>");
const PROMPT = "Read the trial sample using read_trial_sample, then give a brief answer.";
const DONE = "returned the sample.";

const child = pty.spawn(process.execPath, [fileURLToPath(new URL("./main.ts", import.meta.url))], {
  name: "xterm-256color", cols: 60, rows: 24, cwd: process.cwd(),
  env: { ...process.env, PI_STOCK_UI_OFF: "1", PI_TRIAL_DEMO_TEXT: "1", PI_TRIAL_PACE: "50" },
  useConptyDll: true,
});
let output = "";
let typed = false;
let finished = false;
child.onData(data => { output += data; });

const deadline = Date.now() + 60_000;
const timer = setInterval(() => {
  if (Date.now() > deadline) {
    stop();
    console.error("Recording timed out.");
    process.exit(1);
  }
  if (!typed && output.includes("0.87.1")) { typed = true; child.write(PROMPT); }
  // Pi bounces Enter while startup is in progress; resubmit until the turn starts.
  if (typed && !output.includes("Working") && !finished) child.write("\r");
  if (!finished && output.includes(DONE)) {
    finished = true;
    // Let the final frame and footer settle before closing.
    setTimeout(() => { stop(); save(); }, 1500);
  }
}, 1000);

function stop(): void {
  clearInterval(timer);
  try { child.kill(); } catch { /* already exited */ }
}

function save(): void {
  const scrubbed = output.replace(/[A-Za-z]:\\[^\s\x1b]*tui-pi-stock-ui-[A-Za-z0-9]+/g, "<trial-cwd>");
  writeFileSync(target!, scrubbed, "utf8");
  console.log(`Recorded ${scrubbed.length} characters to ${target}.`);
  // node-pty's ConPTY handles keep the event loop alive after kill on Windows.
  process.exit(0);
}
