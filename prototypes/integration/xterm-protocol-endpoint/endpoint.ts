import type { IDisposable, Terminal } from "@xterm/headless";

import {
  TerminalProtocolEndpoint,
  type EndpointResult,
} from "@tui-protocol/terminal";
import type { SessionContextSnapshot, SessionResourceLimits } from "@tui-protocol/terminal";
import {
  XtermTerminalAdapter,
  type RenderedBlock,
  type RenderedBlockRange,
  type XtermBlockHistory,
} from "./adapter.ts";

export interface XtermProtocolEndpointOptions {
  readonly completeBaselineSupported: boolean;
  /** Optional content types this composition completely implements. */
  readonly optionalContentTypes?: readonly ("text/styled" | "text/lines")[];
  readonly history?: XtermBlockHistory;
  readonly resourceLimits?: SessionResourceLimits;
}

/**
 * Experimental composition of the protocol endpoint and the private xterm.js
 * history spike. This is not a stable Terminal integration API.
 */
export class XtermProtocolEndpoint implements IDisposable {
  readonly #endpoint: TerminalProtocolEndpoint;
  readonly #adapter: XtermTerminalAdapter;

  constructor(terminal: Terminal, options: XtermProtocolEndpointOptions) {
    this.#adapter = new XtermTerminalAdapter(terminal, options.history, error => this.abort(error));
    this.#endpoint = new TerminalProtocolEndpoint({
      completeBaselineSupported: options.completeBaselineSupported,
      optionalContentTypes: options.optionalContentTypes,
      resourceLimits: options.resourceLimits,
      operationAdapter: this.#adapter,
    });
  }

  push(bytes: Uint8Array): EndpointResult {
    try {
      return this.#endpoint.push(bytes);
    } catch (error: unknown) {
      this.abort(error);
      throw error;
    }
  }

  abort(reason: unknown): void {
    this.#adapter.stop(reason);
    this.#endpoint.abort(reason);
  }

  finish(): EndpointResult {
    return this.#endpoint.finish();
  }

  async drain(): Promise<void> {
    await this.#adapter.drain();
  }

  context(id: string): SessionContextSnapshot | undefined {
    return this.#endpoint.context(id);
  }

  contexts(): readonly SessionContextSnapshot[] {
    return this.#endpoint.contexts();
  }

  reclaimClosedContext(id: string): SessionContextSnapshot | undefined {
    if (!this.#adapter.supportsContextReclamation()) {
      throw new Error("Closed-Context reclamation requires renderer-owned ranges and eviction cleanup.");
    }
    const snapshot = this.#endpoint.reclaimClosedContext(id);
    if (snapshot !== undefined) this.#adapter.reclaimContext(id);
    return snapshot;
  }

  invalidateContextsIntersectingRows(
    start: number,
    end: number,
  ): readonly string[] {
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
      throw new Error("The invalidation row range must be non-empty integers.");
    }
    const affected: string[] = [];
    const rendered = this.#adapter.renderedBlocks();
    if (rendered !== undefined) {
      const impacted = new Set(rendered.filter(block =>
        block.range.start < end && start < block.range.start + block.range.lineCount,
      ).map(block => block.contextId));
      const invalidated = new Set<string>();
      for (const block of rendered) {
        if (!impacted.has(block.contextId)) continue;
        if (!invalidated.has(block.contextId) && this.#endpoint.invalidateContext(block.contextId)) {
          invalidated.add(block.contextId);
          affected.push(block.contextId);
        }
        this.#adapter.retireContextBlocks(block.contextId, [block.blockId]);
      }
      return affected;
    }
    for (const context of this.#endpoint.contexts()) {
      const intersects = context.blocks.some((block) => {
        const range = this.#adapter.range(context.id, block.id);
        return (
          range !== undefined &&
          range.start < end &&
          start < range.start + range.lineCount
        );
      });
      if (!intersects) {
        continue;
      }
      if (
        context.state === "open" &&
        this.#endpoint.invalidateContext(context.id)
      ) {
        affected.push(context.id);
      }
      this.#adapter.retireContextBlocks(
        context.id,
        context.blocks.map((block) => block.id),
      );
    }
    return affected;
  }

  acceptDecoded(
    event: Parameters<TerminalProtocolEndpoint["acceptDecoded"]>[0],
  ): EndpointResult {
    try {
      return this.#endpoint.acceptDecoded(event);
    } catch (error: unknown) {
      this.abort(error);
      throw error;
    }
  }

  range(contextId: string, blockId: string): RenderedBlockRange | undefined {
    return this.#adapter.range(contextId, blockId);
  }

  renderedBlocks(): readonly RenderedBlock[] | undefined {
    return this.#adapter.renderedBlocks();
  }

  dispose(): void {
    this.#adapter.dispose();
  }
}
