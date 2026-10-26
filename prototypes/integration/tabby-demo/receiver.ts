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
  readonly writeOrdinary?: (data: Uint8Array) => Promise<void>;
  readonly finishOrdinary?: () => Promise<void>;
  readonly onResponseFrame: (frame: Uint8Array) => void;
  readonly onDiagnostic?: (diagnostic: EndpointDiagnostic) => void;
  readonly onFailure?: (error: Error) => void;
}

export class TabbyProtocolReceiver {
  readonly #endpoint: XtermProtocolEndpoint;
  readonly #ingress: XtermMixedStreamIngress;
  readonly #region: AppRegionTracker | undefined;
  readonly #onFailure: ((error: Error) => void) | undefined;
  #pending: Promise<void> = Promise.resolve();
  #failure: Error | undefined;
  #finished = false;
  #disposed = false;

  constructor(options: TabbyProtocolReceiverOptions) {
    const terminal = options.terminal as unknown as HeadlessTerminal;
    this.#onFailure = options.onFailure;
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
    this.#pending = task.catch((error: unknown) => {
      this.#fail(error);
    });
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
