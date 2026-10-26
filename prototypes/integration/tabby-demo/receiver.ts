import type { Terminal as BrowserTerminal } from "@xterm/xterm";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import {
  trialSessionLimits,
  type EndpointDiagnostic,
  type SessionContextSnapshot,
} from "@tui-protocol/terminal";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";
import {
  AppRegionTracker,
  XtermMixedStreamIngress,
  XtermProtocolEndpoint,
  type RenderedBlockRange,
} from "../xterm-protocol-endpoint/index.ts";

export interface TabbyProtocolReceiverOptions {
  readonly terminal: BrowserTerminal;
  readonly region?: boolean;
  readonly reclaimClosedContexts?: boolean;
  readonly writeOrdinary?: (data: Uint8Array) => Promise<void>;
  readonly finishOrdinary?: () => Promise<void>;
  readonly onResponseFrame: (frame: Uint8Array) => void;
  readonly onDiagnostic?: (diagnostic: EndpointDiagnostic) => void;
  readonly onFailure?: (error: Error) => void;
}

export interface TabbyProtocolReceiverMetrics {
  readonly reclaimClosedContexts: boolean;
  readonly closedContexts: number;
  readonly closedBlocks: number;
  readonly sealedBlocks: number;
  readonly lastReclaimedContextId: string | undefined;
  readonly renderedBlocks: number | undefined;
}

export class TabbyProtocolReceiver {
  readonly #endpoint: XtermProtocolEndpoint;
  readonly #ingress: XtermMixedStreamIngress;
  readonly #region: AppRegionTracker | undefined;
  readonly #onFailure: ((error: Error) => void) | undefined;
  readonly #reclaimClosed: boolean;
  #closedContexts = 0;
  #closedBlocks = 0;
  #sealedBlocks = 0;
  #lastReclaimedContextId: string | undefined;
  #pending: Promise<void> = Promise.resolve();
  #failure: Error | undefined;
  #finished = false;
  #disposed = false;

  constructor(options: TabbyProtocolReceiverOptions) {
    const terminal = options.terminal as unknown as HeadlessTerminal;
    this.#onFailure = options.onFailure;
    this.#reclaimClosed = options.reclaimClosedContexts === true;
    this.#region = options.region === false
      ? undefined
      : new AppRegionTracker(terminal);
    const history = new PrivateCoreBlockHistory(terminal, { region: this.#region });
    this.#endpoint = new XtermProtocolEndpoint(terminal, {
      completeBaselineSupported: true,
      optionalContentTypes: ["text/styled", "text/lines"],
      history,
      resourceLimits: trialSessionLimits,
    });
    this.#ingress = new XtermMixedStreamIngress(terminal, this.#endpoint, {
      pendingInputLimits: { bytes: 2 * 1024 * 1024, pushes: 512 },
      region: this.#region,
      clearRecovery: this.#region === undefined ? undefined : history,
      writeOrdinary: options.writeOrdinary,
      finishOrdinary: options.finishOrdinary,
      onResponseFrame: options.onResponseFrame,
      onDiagnostic: diagnostic => options.onDiagnostic?.(diagnostic),
    });
  }

  feed(bytes: Uint8Array): void {
    if (this.#finished || this.#disposed || this.#failure !== undefined) return;
    try {
      this.#track(this.#ingress.push(bytes));
    } catch (error) {
      this.#fail(error);
    }
  }

  async drain(): Promise<void> {
    await this.#pending;
    await this.#endpoint.drain();
    if (this.#failure !== undefined) throw this.#failure;
    this.#reclaimClosedContexts();
  }

  async finish(): Promise<void> {
    if (!this.#finished && !this.#disposed) {
      this.#finished = true;
      try {
        this.#track(this.#ingress.finish());
      } catch (error) {
        this.#fail(error);
      }
    }
    await this.drain();
  }

  contexts(): readonly SessionContextSnapshot[] {
    return this.#endpoint.contexts();
  }

  metrics(): TabbyProtocolReceiverMetrics {
    return {
      reclaimClosedContexts: this.#reclaimClosed,
      closedContexts: this.#closedContexts,
      closedBlocks: this.#closedBlocks,
      sealedBlocks: this.#sealedBlocks,
      lastReclaimedContextId: this.#lastReclaimedContextId,
      renderedBlocks: this.#endpoint.renderedBlocks()?.length,
    };
  }

  range(contextId: string, blockId: string): RenderedBlockRange | undefined {
    return this.#endpoint.range(contextId, blockId);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#finished = true;
    this.#ingress.dispose();
    this.#endpoint.dispose();
    this.#region?.dispose();
  }

  #track(task: Promise<void>): void {
    this.#pending = task.then(() => {
      this.#reclaimClosedContexts();
    }).catch((error: unknown) => {
      this.#fail(error);
    });
  }

  #reclaimClosedContexts(): void {
    if (!this.#reclaimClosed || this.#failure !== undefined) return;
    for (const context of this.#endpoint.contexts()) {
      if (context.state !== "closed") continue;
      const snapshot = this.#endpoint.reclaimClosedContext(context.id);
      if (snapshot === undefined) continue;
      this.#closedContexts += 1;
      this.#closedBlocks += snapshot.blocks.length;
      this.#sealedBlocks += snapshot.blocks.filter(block => block.lifecycle === "sealed").length;
      this.#lastReclaimedContextId = snapshot.id;
    }
  }

  #fail(reason: unknown): void {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    if (this.#failure !== undefined) return;
    this.#failure = error;
    try {
      this.#endpoint.abort(error);
    } catch {}
    try {
      this.#onFailure?.(error);
    } catch {}
  }
}
