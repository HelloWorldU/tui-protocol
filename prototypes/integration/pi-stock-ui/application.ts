import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { ProcessTerminal, type Terminal } from "@earendil-works/pi-tui";
import { TuiClient } from "@tui-protocol/sdk";
import { ProtocolTranscriptBridge } from "./bridge.ts";
import { formatPatchReport, installRenderGate, setRenderGate, type PatchReportEntry } from "./render-gate.ts";
import type { TrialRuntimeSource } from "./session-source.ts";
import { TrialTerminal, type TrialInput, type TrialOutput } from "./terminal.ts";

export interface StockUiTrialOptions {
  readonly input: TrialInput;
  readonly output: TrialOutput;
  readonly source: TrialRuntimeSource;
  /** Negotiation deadline; the trial spec fixes 2000 ms. */
  readonly timeoutMs?: number;
  /** Trial flag: false never negotiates and never emits a protocol byte. */
  readonly protocol?: boolean;
  /**
   * Stock-path terminal factory. The browser child passes ProcessTerminal so an
   * unsupported answer means byte-for-byte stock Pi; the Node tests pass the
   * trial wrapper back through to keep process stdio untouched.
   */
  readonly stockTerminal?: (trialTerminal: TrialTerminal) => Terminal;
  /** Latched protocol failure hook (render-gate, bridge, or input-split failures). */
  readonly onFailure?: (error: Error) => void;
}

export interface PreparedTrial {
  readonly mode: "protocol" | "stock";
  readonly patchReport: readonly PatchReportEntry[];
  readonly interactiveMode: InteractiveMode;
  readonly trialTerminal: TrialTerminal;
  readonly bridge?: ProtocolTranscriptBridge;
  readonly client?: TuiClient;
  readonly failure?: Error;
}

/**
 * Composition root. Negotiation runs before the UI starts; on a negative or
 * skipped answer Pi runs stock (render gate inactive, no Blocks). On a positive
 * answer the gate activates and a second session.subscribe listener feeds Blocks.
 */
export async function prepareStockUiTrial(options: StockUiTrialOptions): Promise<PreparedTrial> {
  const { input, output, source } = options;
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure ??= error;
    options.onFailure?.(failure);
  };
  const patchReport = installRenderGate();
  setRenderGate(false);
  const stock = (terminal: TrialTerminal) => options.stockTerminal?.(terminal) ?? new ProcessTerminal();
  if (options.protocol === false) {
    const client = new TuiClient({
      write: () => { throw new Error("Protocol is disabled in this trial run"); },
      timeoutMs: options.timeoutMs ?? 2000,
    });
    const terminal = new TrialTerminal({ input, output, client, onProtocolFailure: fail });
    writeLines(output, ["[pi-stock-ui] protocol disabled by trial flag; running stock Pi 0.87.1.",
      "[pi-stock-ui] patch report: gate installed, never activated."]);
    return {
      mode: "stock", patchReport, trialTerminal: terminal,
      interactiveMode: new InteractiveMode(source.runtime, { terminal: stock(terminal) }),
      get failure() { return failure; },
    };
  }

  const client = new TuiClient({
    write: bytes => { output.write(Buffer.from(bytes)); },
    timeoutMs: options.timeoutMs ?? 2000,
  });
  const terminal = new TrialTerminal({ input, output, client, onProtocolFailure: fail });
  terminal.attach();
  let supported = false;
  try {
    supported = await client.negotiate();
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
  }
  if (failure) throw failure;

  if (!supported) {
    terminal.detach();
    client.dispose();
    writeLines(output, ["[pi-stock-ui] protocol unsupported by this terminal; running stock Pi 0.87.1.",
      "[pi-stock-ui] patch report: gate installed, never activated."]);
    return {
      mode: "stock", patchReport, trialTerminal: terminal,
      interactiveMode: new InteractiveMode(source.runtime, { terminal: stock(terminal) }),
      get failure() { return failure; },
    };
  }

  setRenderGate(true);
  const bridge = new ProtocolTranscriptBridge({ client, onFailure: fail });
  bridge.attach(source.runtime.session);
  writeLines(output, [
    "[pi-stock-ui] protocol supported; transcript is terminal-owned, chrome stays Pi-rendered.",
    "[pi-stock-ui] patch report:",
    ...formatPatchReport(patchReport).split("\n"),
  ]);
  return {
    mode: "protocol", patchReport, bridge, client, trialTerminal: terminal,
    interactiveMode: new InteractiveMode(source.runtime, {
      terminal, startupDiagnostics: [...source.runtime.diagnostics],
    }),
    get failure() { return failure; },
  };
}

function writeLines(output: TrialOutput, lines: readonly string[]): void {
  output.write(`${lines.join("\r\n")}\r\n`);
}
