import type { IDisposable, Terminal } from "@xterm/headless";

import type { ContentFragment, ContentSnapshot, LinesTextLine } from "@tui-protocol/protocol";
import type { BlockContent, Operation } from "../../block-model/model.ts";
import type { OperationExecutionErrorCode } from "@tui-protocol/terminal";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";
import type {
  AppliedBlockOperation,
  TerminalOperationAdapter,
} from "@tui-protocol/terminal";

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
  /** Resolves when renders and resize relayouts have reached the buffer. */
  settled?(): Promise<void>;
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
  #failure: Error | undefined;
  readonly #onFailure: (error: Error) => void;

  constructor(terminal: Terminal, history?: XtermBlockHistory, onFailure: (error: Error) => void = () => {}) {
    this.#history = history ?? new PrivateCoreBlockHistory(terminal);
    this.#onFailure = onFailure;
  }

  prepare(
    operation: AppliedBlockOperation,
  ): OperationExecutionErrorCode | undefined {
    if (this.#failure !== undefined) throw this.#failure;
    return this.#history.wouldExceedCapacity(toRenderingOperation(operation))
      ? "resource_exhausted"
      : undefined;
  }

  accept(operation: AppliedBlockOperation): void {
    if (this.#failure !== undefined) throw this.#failure;
    const renderingOperation = toRenderingOperation(operation);
    this.#history.accept(renderingOperation);
    this.#rendering = this.#rendering.then(async () => {
      if (this.#failure !== undefined) return;
      try {
        await this.#history.renderAccepted(renderingOperation);
      } catch (error: unknown) {
        this.stop(error);
        this.#onFailure(this.#failure!);
      }
    });
  }

  stop(reason: unknown): void {
    this.#failure ??= reason instanceof Error ? reason : new Error(String(reason));
  }

  async drain(): Promise<void> {
    await this.#rendering;
    await this.#history.settled?.();
    if (this.#failure !== undefined) throw this.#failure;
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
          content: snapshotContent(operation.body.content),
        },
      };
    case "block.update":
      return { type: "update", id, content: snapshotContent(operation.body.content) };
    case "block.extend":
      return { type: "extend", id, fragment: renderable(operation.body.fragment) };
    case "block.replace_suffix":
      return {
        type: "replaceSuffix",
        id,
        retain: operation.body.retain,
        replacement: renderable(operation.body.replacement),
      };
    case "block.seal":
      return { type: "seal", id };
    default:
      return assertNever(operation);
  }
}

/**
 * text/lines arrays become the history's lines content, which it lays out
 * itself; an empty replacement array stays a plain empty array, which the
 * history treats as removing the suffix for either array-shaped type.
 */
function renderable(content: ContentFragment): BlockContent {
  if (Array.isArray(content) && content.length > 0 && "spans" in content[0]) {
    return { lines: content as readonly LinesTextLine[] };
  }
  return content as BlockContent;
}

/** A full snapshot by its declared type, so an empty text/lines value stays lines. */
function snapshotContent(snapshot: ContentSnapshot): BlockContent {
  return snapshot.type === "text/lines" ? { lines: snapshot.data } : snapshot.data;
}

function renderBlockId(contextId: string, blockId: string): string {
  return JSON.stringify([contextId, blockId]);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected accepted Operation: ${JSON.stringify(value)}`);
}
