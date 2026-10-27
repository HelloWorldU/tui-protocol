import { createPairedTrial, type PairedTrial } from "./paired.ts";
import { PairHost, type FrontendRole } from "./pair-transport.ts";
import { FakeInput, FakeOutput } from "./fake-host.ts";
import { createFixtureModel } from "./fixtures/provider.ts";
import { createTrialRuntime, type TrialRuntimeSource } from "./session-source.ts";

const stockInput = new FakeInput();
const protocolInput = new FakeInput();
const stockOutput = new FakeOutput();
const protocolOutput = new FakeOutput();
const pace = Number(process.env.PI_TRIAL_PACE);
const pacing = Number.isInteger(pace) && pace > 0 && pace <= 10_000 ? pace : 200;
const toolPause = Number(process.env.PI_TRIAL_TOOL_PAUSE);
const toolPauseMs = Number.isInteger(toolPause) && toolPause >= 0 && toolPause <= 60_000 ? toolPause : 600;
let source: TrialRuntimeSource | undefined;
let pair: PairedTrial | undefined;
let host: PairHost | undefined;
let failure: Error | undefined;
let stopping = false;
let inputEvents = 0;
let unsubscribe: (() => void) | undefined;
const deadline = setTimeout(() => fail(new Error("Paired demonstration deadline exceeded")), 120_000);

function fail(reason: unknown): void {
  failure ??= reason instanceof Error ? reason : new Error(String(reason));
  console.error(`[pair] ${failure.message}`);
  void shutdown();
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearTimeout(deadline);
  unsubscribe?.();
  try {
    if (pair) await pair.stop();
    else await source?.dispose();
  } catch (error) {
    failure ??= error instanceof Error ? error : new Error(String(error));
  }
  try {
    await host?.close();
  } catch (error) {
    failure ??= error instanceof Error ? error : new Error(String(error));
  }
  if (failure) process.exitCode = 1;
}

async function main(): Promise<void> {
  const fixture = await createFixtureModel(pacing, undefined, 40,
    process.env.PI_TRIAL_DEMO_TEXT === "1"
      ? {
          result: [
            "## Trial answer\n\n",
            "The sample reports: **mutable history",
            " keeps old output readable**.\n\n",
            "- Styling comes from Pi's real renderer\n- `text/styled` carried it\n\n",
            "`read_trial_sample` returned the sample.",
          ],
        }
      : undefined);
  source = await createTrialRuntime(fixture, toolPauseMs, { maxToolCalls: 4 });
  const activeSource = source;
  unsubscribe = activeSource.runtime.session.subscribe(event => {
    switch (event.type) {
      case "agent_start":
        console.log("[pair] phase agent_start");
        break;
      case "tool_execution_start":
        console.log("[pair] phase tool_start");
        break;
      case "tool_execution_update":
        console.log("[pair] phase tool_progress");
        break;
      case "agent_end":
        console.log(`[pair] phase complete; toolCalls=${activeSource.toolCalls()}`);
        break;
    }
  });
  host = new PairHost({
    port: Number(process.env.PI_PAIR_PORT ?? 4194),
    onReady: async () => {
      pair = await createPairedTrial({
        source: activeSource,
        stockInput,
        stockOutput,
        protocolInput,
        protocolOutput,
        writePatchReportToStock: true,
        onFailure: fail,
      });
      await pair.init();
    },
    onInput: data => {
      inputEvents += 1;
      console.log(`[pair] input ${inputEvents}: ${data.length} bytes`);
      protocolInput.write(data);
    },
    onResize: (role: FrontendRole, columns: number, rows: number) => {
      const output = role === "stock" ? stockOutput : protocolOutput;
      output.columns = columns;
      output.rows = rows;
      output.emit("resize");
    },
    onError: fail,
  });
  stockOutput.on("data", (chunk: Buffer) => host!.send("stock", chunk));
  protocolOutput.on("data", (chunk: Buffer) => host!.send("protocol", chunk));
  const { port, token } = await host.start();
  console.log(`[pair] host listening on ${port}; token ${token}`);
  await host.ready;
  console.log("[pair] frontends ready");
  void pair!.protocol.interactiveMode.run().catch(fail);
}

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
try {
  await main();
} catch (error) {
  fail(error);
}
