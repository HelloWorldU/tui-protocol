import type { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { prepareStockUiTrial, type PreparedTrial } from "./application.ts";
import { formatPatchReport, renderGateActive, setRenderGate, withRenderGate } from "./render-gate.ts";
import type { TrialRuntimeSource } from "./session-source.ts";
import type { TrialInput, TrialOutput } from "./terminal.ts";

export interface PairedTrialOptions {
  readonly source: TrialRuntimeSource;
  readonly stockInput: TrialInput;
  readonly stockOutput: TrialOutput;
  readonly protocolInput: TrialInput;
  readonly protocolOutput: TrialOutput;
  readonly writePatchReportToStock?: boolean;
  readonly onFailure?: (error: Error) => void;
}

export interface PairedTrial {
  readonly source: TrialRuntimeSource;
  readonly stock: PreparedTrial;
  readonly protocol: PreparedTrial;
  init(): Promise<void>;
  stop(): Promise<void>;
}

export async function createPairedTrial(options: PairedTrialOptions): Promise<PairedTrial> {
  const previousGate = renderGateActive();
  const stock = await prepareStockUiTrial({
    input: options.stockInput,
    output: options.stockOutput,
    source: options.source,
    protocol: false,
    stockTerminal: terminal => terminal,
    onFailure: options.onFailure,
  });
  let protocol: PreparedTrial;
  try {
    protocol = await prepareStockUiTrial({
      input: options.protocolInput,
      output: options.protocolOutput,
      source: options.source,
      stockTerminal: terminal => terminal,
      onFailure: options.onFailure,
    });
    if (protocol.mode !== "protocol") {
      throw new Error("The paired protocol frontend did not negotiate protocol support.");
    }
    scopeRendererGate(stock.interactiveMode, false);
    scopeRendererGate(protocol.interactiveMode, true);
    if (options.writePatchReportToStock === true) {
      options.stockOutput.write(`${formatPatchReport(stock.patchReport)}\r\n`);
    }
  } catch (error) {
    setRenderGate(previousGate);
    try { stock.interactiveMode.stop(); } catch {}
    try { stock.client?.dispose(); } catch {}
    throw error;
  }

  return {
    source: options.source,
    stock,
    protocol,
    async init() {
      await stock.interactiveMode.init();
      await protocol.interactiveMode.init();
    },
    async stop() {
      try { protocol.interactiveMode.stop(); } catch {}
      try { protocol.client?.dispose(); } catch {}
      try { stock.interactiveMode.stop(); } catch {}
      try { stock.client?.dispose(); } catch {}
      setRenderGate(previousGate);
      await options.source.dispose();
    },
  };
}

function scopeRendererGate(mode: InteractiveMode, value: boolean): void {
  const renderer = (mode as unknown as { renderer: { doRender(): void } }).renderer;
  const doRender = renderer.doRender;
  if (typeof doRender !== "function") throw new Error("The pinned Pi renderer has no doRender method.");
  renderer.doRender = function (): void {
    withRenderGate(value, () => doRender.call(this));
  };
}
