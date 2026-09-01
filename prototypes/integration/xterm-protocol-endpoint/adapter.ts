import type { IDisposable, Terminal } from "@xterm/headless";

import type { Operation } from "../../block-model/model.ts";
import type { OperationExecutionErrorCode } from "../../protocol-session/index.ts";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";
import type {
  AppliedBlockOperation,
  TerminalOperationAdapter,
} from "../protocol-endpoint/index.ts";

export interface RenderedBlockRange {
  readonly start: number;
  readonly lineCount: number;
}

export interface XtermBlockHistory extends IDisposable {
  wouldExceedCapacity(operation: Operation): boolean;
  accept(operation: Operation): void;
  renderAccepted(operation: Operation): Promise<void>;
  range(id: string): Readonly<RenderedBlockRange> | undefined;
  retire(id: string): void;
}

/**
 * Experimental adapter from accepted protocol Operations to the current
 * private xterm.js Block-history implementation.
 */
export class XtermTerminalAdapter
  implements TerminalOperationAdapter, IDisposable
{
  readonly #history: XtermBlockHistory;
  #rendering: Promise<void> = Promise.resolve();

  constructor(terminal: Terminal, history?: XtermBlockHistory) {
    this.#history = history ?? new PrivateCoreBlockHistory(terminal);
  }

  prepare(
    operation: AppliedBlockOperation,
  ): OperationExecutionErrorCode | undefined {
    return this.#history.wouldExceedCapacity(toRenderingOperation(operation))
      ? "resource_exhausted"
      : undefined;
  }

  accept(operation: AppliedBlockOperation): void {
    const renderingOperation = toRenderingOperation(operation);
    this.#history.accept(renderingOperation);
    this.#rendering = this.#rendering.then(() =>
      this.#history.renderAccepted(renderingOperation),
    );
  }

  async drain(): Promise<void> {
    await this.#rendering;
  }

  range(
    contextId: string,
    blockId: string,
  ): Readonly<RenderedBlockRange> | undefined {
    return this.#history.range(renderBlockId(contextId, blockId));
  }

  retireContextBlocks(contextId: string, blockIds: readonly string[]): void {
    for (const blockId of blockIds) {
      this.#history.retire(renderBlockId(contextId, blockId));
    }
  }

  dispose(): void {
    this.#history.dispose();
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
    case "block.replace_suffix":
      return {
        type: "replaceSuffix",
        id,
        retain: operation.body.retain,
        replacement: operation.body.replacement,
      };
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
  throw new Error(`Unexpected accepted Operation: ${JSON.stringify(value)}`);
}
