import type { IDisposable, Terminal } from "@xterm/headless";

import {
  ProtocolStreamDecoder,
  type DecoderEvent,
} from "@tui-protocol/protocol";
import type {
  EndpointDiagnostic,
  EndpointResult,
} from "@tui-protocol/terminal";
import { PendingInputBudget } from "@tui-protocol/terminal";
import type { AppRegionTracker } from "./app-region.ts";
import type { XtermProtocolEndpoint } from "./endpoint.ts";

export interface XtermMixedStreamIngressOptions {
  readonly pendingInputLimits?: { bytes: number; pushes: number };
  /**
   * Opt-in experimental app-region tracking. When present, the ingress
   * samples the cursor row around ordinary writes and on row-affecting
   * cursor sequences, and resets the estimate on display erases and reset.
   */
  readonly region?: AppRegionTracker;
  readonly onResponseFrame: (frame: Uint8Array) => void;
  readonly onDiagnostic: (diagnostic: EndpointDiagnostic) => void;
}

/**
 * Experimental raw ingress that orders protocol realization and ordinary
 * xterm.js writes on one queue. It is not a stable Terminal integration API.
 */
export class XtermMixedStreamIngress implements IDisposable {
  readonly #terminal: Terminal;
  readonly #endpoint: XtermProtocolEndpoint;
  readonly #decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
  readonly #onResponseFrame: (frame: Uint8Array) => void;
  readonly #onDiagnostic: (diagnostic: EndpointDiagnostic) => void;
  readonly #region: AppRegionTracker | undefined;
  readonly #registrations: IDisposable[];
  #processing: Promise<void> = Promise.resolve();
  #ended = false;
  readonly #budget: PendingInputBudget | undefined;

  constructor(
    terminal: Terminal,
    endpoint: XtermProtocolEndpoint,
    options: XtermMixedStreamIngressOptions,
  ) {
    this.#terminal = terminal;
    this.#budget = options.pendingInputLimits && new PendingInputBudget(options.pendingInputLimits.bytes, options.pendingInputLimits.pushes);
    this.#endpoint = endpoint;
    this.#onResponseFrame = options.onResponseFrame;
    this.#onDiagnostic = options.onDiagnostic;
    this.#region = options.region;
    this.#registrations = [
      terminal.parser.registerCsiHandler({ final: "K" }, (params) => {
        const mode = firstParameter(params);
        if (mode >= 0 && mode <= 2) {
          this.#invalidateActiveRows(currentRow(terminal), 1);
        }
        return false;
      }),
      terminal.parser.registerCsiHandler({ final: "J" }, (params) => {
        const mode = firstParameter(params);
        const buffer = terminal.buffer.active;
        if (
          buffer.type === "normal" &&
          mode === 2 &&
          !terminal.options.scrollOnEraseInDisplay
        ) {
          this.#invalidateActiveRows(buffer.baseY, terminal.rows);
          this.#region?.reset();
        } else if (buffer.type === "normal" && mode === 3) {
          this.#invalidateActiveRows(
            0,
            Math.max(0, buffer.length - terminal.rows),
          );
          this.#region?.reset();
        }
        return false;
      }),
      terminal.parser.registerEscHandler({ final: "c" }, () => {
        const normal = terminal.buffer.normal;
        if (normal.length > 0) {
          this.#endpoint.invalidateContextsIntersectingRows(0, normal.length);
        }
        this.#region?.reset();
        return false;
      }),
    ];
    if (this.#region !== undefined) {
      // Region-mode cursor observation for the passive extent estimate.
      // Handlers run before execution, so relative targets are computed from
      // the pre-move row and absolute targets from the parameter itself.
      // The alternate screen is a different coordinate space; like the
      // watchdog's row checks, observation applies to the normal buffer only.
      const observeRelative = (sign: 1 | -1) =>
        (params: readonly (number | number[])[]): boolean => {
          if (terminal.buffer.active.type === "normal") {
            this.#region?.noteCursorRow(relativeRowTarget(terminal, params, sign));
          }
          return false;
        };
      const observeAbsolute = (
        params: readonly (number | number[])[],
      ): boolean => {
        if (terminal.buffer.active.type === "normal") {
          this.#region?.noteCursorRow(absoluteRowTarget(terminal, params));
        }
        return false;
      };
      this.#registrations.push(
        terminal.parser.registerCsiHandler({ final: "A" }, observeRelative(-1)),
        terminal.parser.registerCsiHandler({ final: "B" }, observeRelative(1)),
        terminal.parser.registerCsiHandler({ final: "E" }, observeRelative(1)),
        terminal.parser.registerCsiHandler({ final: "F" }, observeRelative(-1)),
        terminal.parser.registerCsiHandler({ final: "d" }, observeAbsolute),
        terminal.parser.registerCsiHandler({ final: "H" }, observeAbsolute),
        terminal.parser.registerCsiHandler({ final: "f" }, observeAbsolute),
      );
    }
  }

  push(bytes: Uint8Array): Promise<void> {
    if (this.#ended) {
      throw new Error("Mixed-stream ingress cannot receive bytes after finish.");
    }
    let release: (() => void) | undefined;
    let owned: Uint8Array;
    try { release = this.#budget?.acquire(bytes.byteLength); owned = bytes.slice(); }
    catch (error) { release?.(); this.#endpoint.abort(error); this.#ended = true; throw error; }
    const task = this.#processing.then(async () => {
      await this.#consume(this.#decoder.push(owned));
    }).catch((error: unknown) => {
      this.#endpoint.abort(error);
      throw error;
    }).finally(() => release?.());
    this.#processing = task;
    return task;
  }

  finish(): Promise<void> {
    if (this.#ended) {
      return this.#processing;
    }
    this.#ended = true;
    const task = this.#processing.then(async () => {
      await this.#consume(this.#decoder.finish());
      this.#dispatch(this.#endpoint.finish());
      await this.#endpoint.drain();
    }).catch((error: unknown) => {
      this.#endpoint.abort(error);
      throw error;
    });
    this.#processing = task;
    return task;
  }

  async drain(): Promise<void> {
    await this.#processing;
    await this.#endpoint.drain();
  }

  dispose(): void {
    for (const registration of this.#registrations.splice(0)) {
      registration.dispose();
    }
  }

  async #consume(events: readonly DecoderEvent[]): Promise<void> {
    // An externally aborted endpoint must also stop ordinary-only input,
    // including input supplied through a newly created ingress wrapper.
    await this.#endpoint.drain();
    for (const event of events) {
      if (event.type === "ordinary") {
        this.#noteRegionCursorRow();
        await write(this.#terminal, event.data);
        this.#noteRegionCursorRow();
        continue;
      }
      this.#dispatch(this.#endpoint.acceptDecoded(event));
      await this.#endpoint.drain();
    }
  }

  #dispatch(result: EndpointResult): void {
    for (const diagnostic of result.diagnostics) {
      this.#onDiagnostic(diagnostic);
    }
    for (const frame of result.responseFrames) {
      this.#onResponseFrame(frame);
    }
  }

  #invalidateActiveRows(start: number, lineCount: number): void {
    if (this.#terminal.buffer.active.type !== "normal" || lineCount <= 0) {
      return;
    }
    this.#endpoint.invalidateContextsIntersectingRows(
      start,
      start + lineCount,
    );
  }

  /** Feeds the current cursor row to the region estimate (normal buffer only). */
  #noteRegionCursorRow(): void {
    if (this.#terminal.buffer.active.type === "normal") {
      this.#region?.noteCursorRow(currentRow(this.#terminal));
    }
  }
}

function firstParameter(params: readonly (number | number[])[]): number {
  const first = params[0];
  return typeof first === "number" ? first : 0;
}

function currentRow(terminal: Terminal): number {
  const buffer = terminal.buffer.active;
  return buffer.baseY + buffer.cursorY;
}

/**
 * The absolute buffer row a relative cursor-up/down sequence will move to,
 * clamped to the viewport like the execution that follows it. Scroll-region
 * margins are not modeled; the placement contradiction check is the backstop.
 */
function relativeRowTarget(
  terminal: Terminal,
  params: readonly (number | number[])[],
  sign: 1 | -1,
): number {
  const buffer = terminal.buffer.active;
  const amount = Math.max(firstParameter(params), 1);
  const row = buffer.baseY + buffer.cursorY + sign * amount;
  return Math.min(buffer.baseY + terminal.rows - 1, Math.max(buffer.baseY, row));
}

/** The absolute buffer row a CUP/HVP/VPA sequence will move to. */
function absoluteRowTarget(
  terminal: Terminal,
  params: readonly (number | number[])[],
): number {
  const buffer = terminal.buffer.active;
  const row = Math.min(Math.max(firstParameter(params), 1), terminal.rows);
  return buffer.baseY + row - 1;
}

function write(terminal: Terminal, data: Uint8Array): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}
