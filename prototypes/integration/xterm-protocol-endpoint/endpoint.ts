import type { IDisposable, Terminal } from "@xterm/headless";

import type { Operation } from "../../block-model/model.ts";
import {
  TerminalProtocolEndpoint,
  type AppliedBlockOperation,
  type EndpointResult,
} from "../protocol-endpoint/index.ts";
import type { SessionContextSnapshot } from "../../protocol-session/index.ts";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";

export interface XtermProtocolEndpointOptions {
  readonly completeBaselineSupported: boolean;
}

export interface RenderedBlockRange {
  readonly start: number;
  readonly lineCount: number;
}

/**
 * Experimental composition of the protocol endpoint and the private xterm.js
 * history spike. This is not a stable Terminal integration API.
 */
export class XtermProtocolEndpoint implements IDisposable {
  readonly #endpoint: TerminalProtocolEndpoint;
  readonly #history: PrivateCoreBlockHistory;
  #rendering: Promise<void> = Promise.resolve();

  constructor(terminal: Terminal, options: XtermProtocolEndpointOptions) {
    this.#history = new PrivateCoreBlockHistory(terminal);
    this.#endpoint = new TerminalProtocolEndpoint({
      completeBaselineSupported: options.completeBaselineSupported,
      onOperationPrepared: (operation) =>
        this.#history.wouldExceedCapacity(toRenderingOperation(operation))
          ? "resource_exhausted"
          : undefined,
      onOperationApplied: (operation) => this.#enqueue(operation),
    });
  }

  push(bytes: Uint8Array): EndpointResult {
    return this.#endpoint.push(bytes);
  }

  finish(): EndpointResult {
    return this.#endpoint.finish();
  }

  async drain(): Promise<void> {
    await this.#rendering;
  }

  context(id: string): SessionContextSnapshot | undefined {
    return this.#endpoint.context(id);
  }

  contexts(): readonly SessionContextSnapshot[] {
    return this.#endpoint.contexts();
  }

  range(contextId: string, blockId: string): RenderedBlockRange | undefined {
    return this.#history.range(renderBlockId(contextId, blockId));
  }

  dispose(): void {
    this.#history.dispose();
  }

  #enqueue(operation: AppliedBlockOperation): void {
    const renderingOperation = toRenderingOperation(operation);
    this.#history.accept(renderingOperation);
    this.#rendering = this.#rendering.then(() =>
      this.#history.renderAccepted(renderingOperation),
    );
  }
}

function toRenderingOperation(operation: AppliedBlockOperation): Operation {
  const id = renderBlockId(operation.context_id, operation.body.block_id);
  switch (operation.kind) {
    case "block.append":
      return {
        type: "append",
        block: {
          id,
          lifecycle: operation.body.lifecycle,
          content: operation.body.content.data,
        },
      };
    case "block.update":
      return { type: "update", id, content: operation.body.content.data };
    case "block.extend":
      return { type: "extend", id, fragment: operation.body.fragment };
    case "block.seal":
      return { type: "seal", id };
    default:
      return assertNever(operation);
  }
}

function renderBlockId(contextId: string, blockId: string): string {
  return JSON.stringify([contextId, blockId]);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected applied Operation: ${JSON.stringify(value)}`);
}
