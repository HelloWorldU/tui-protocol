import {
  ProtocolStreamDecoder,
  encodeMessageFrames,
  type DecoderEvent,
  type Message,
  type ProtocolDecoderEvent,
} from "@tui-protocol/protocol";
import {
  ProtocolSessionError,
  SessionResourceLimitError,
  TerminalProtocolSession,
  type OperationExecutionErrorCode,
  type SessionContextSnapshot,
} from "./session.ts";
import type { SessionResourceLimits } from "./resource-limits.ts";

const MAX_FRAME_ID = 2_147_483_647;

export type AppliedBlockOperation = Extract<
  Message,
  {
    readonly kind:
      | "block.append"
      | "block.update"
      | "block.extend"
      | "block.replace_suffix"
      | "block.seal";
  }
>;

/**
 * Experimental synchronous boundary between protocol execution and a
 * terminal-side Operation consumer.
 */
export interface TerminalOperationAdapter {
  prepare(
    operation: AppliedBlockOperation,
  ): OperationExecutionErrorCode | undefined;
  accept(operation: AppliedBlockOperation): void;
}

export interface TerminalProtocolEndpointOptions {
  readonly completeBaselineSupported: boolean;
  readonly resourceLimits?: SessionResourceLimits;
  readonly operationAdapter?: TerminalOperationAdapter;
}

export interface EndpointDiagnostic {
  readonly layer: "framing" | "message" | "session" | "host";
  readonly reason: string;
}

export interface EndpointResult {
  readonly responseFrames: readonly Uint8Array[];
  readonly diagnostics: readonly EndpointDiagnostic[];
}

export class ProtocolEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolEndpointError";
  }
}

export class TerminalProtocolEndpoint {
  readonly #decoder = new ProtocolStreamDecoder();
  readonly #session: TerminalProtocolSession;
  readonly #operationAdapter: TerminalOperationAdapter | undefined;
  #nextResponseFrameId = 1;
  #ended = false;
  #failure: ProtocolEndpointError | undefined;

  constructor(options: TerminalProtocolEndpointOptions) {
    this.#session = new TerminalProtocolSession(options);
    this.#operationAdapter = options.operationAdapter;
  }

  push(bytes: Uint8Array): EndpointResult {
    this.#assertCanReceive();
    return this.#process(this.#decoder.push(bytes));
  }

  /** Accepts one event from an external mixed-stream decoder. */
  acceptDecoded(event: ProtocolDecoderEvent): EndpointResult {
    this.#assertCanReceive();
    return this.#process([event]);
  }

  finish(): EndpointResult {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#ended) {
      return emptyResult();
    }

    const result = this.#process(this.#decoder.finish());
    this.#session.endConnection();
    this.#ended = true;
    return result;
  }

  context(id: string): SessionContextSnapshot | undefined {
    return this.#session.context(id);
  }

  contexts(): readonly SessionContextSnapshot[] {
    return this.#session.contexts();
  }

  /** Stop an untrustworthy execution session without claiming rollback or closure. */
  abort(reason: unknown): void {
    this.#failure ??= new ProtocolEndpointError(
      `Protocol execution stopped: ${errorReason(reason)}`,
    );
  }

  invalidateContext(id: string): boolean {
    this.#assertCanReceive();
    return this.#session.invalidateContext(id);
  }

  #process(events: readonly DecoderEvent[]): EndpointResult {
    const responseFrames: Uint8Array[] = [];
    const diagnostics: EndpointDiagnostic[] = [];

    for (const event of events) {
      if (event.type === "ordinary") {
        continue;
      }
      let responses: readonly Message[];
      if (event.type === "error") {
        diagnostics.push({ layer: event.layer, reason: event.reason });
        if (event.identity === undefined) {
          continue;
        }
        try { responses = this.#session.handleInvalidMessage(event.identity); }
        catch (error) { if (error instanceof SessionResourceLimitError) this.abort(error); throw error; }
      } else {
        let appliedOperation: AppliedBlockOperation | undefined;
        try {
          if (isBlockOperation(event.message)) {
            const preparation = this.#session.prepareOperation(event.message);
            if (preparation.status === "rejected") {
              responses = preparation.responses;
            } else {
              let executionError: OperationExecutionErrorCode | undefined;
              try {
                executionError = this.#operationAdapter?.prepare(
                  structuredClone(preparation.operation),
                );
              } catch (error: unknown) {
                diagnostics.push({
                  layer: "host",
                  reason: errorReason(error),
                });
                executionError = "internal_error";
              }
              responses =
                executionError === undefined
                  ? preparation.commit()
                  : preparation.reject(executionError);
              if (responses.length === 0) {
                appliedOperation = structuredClone(preparation.operation);
              }
            }
          } else {
            responses = this.#session.handle(event.message);
          }
        } catch (error: unknown) {
          if (error instanceof SessionResourceLimitError) { this.abort(error); throw error; }
          if (!(error instanceof ProtocolSessionError)) {
            throw error;
          }
          diagnostics.push({ layer: "session", reason: error.message });
          continue;
        }
        if (appliedOperation !== undefined) {
          try {
            this.#operationAdapter?.accept(appliedOperation);
          } catch (error: unknown) {
            this.abort(error);
            throw this.#failure;
          }
        }
      }

      for (const response of responses) {
        responseFrames.push(
          ...encodeMessageFrames(response, this.#takeResponseFrameId()),
        );
      }
    }

    return { responseFrames, diagnostics };
  }

  #assertCanReceive(): void {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#ended) {
      throw new ProtocolEndpointError(
        "Protocol endpoint cannot receive bytes after its connection ends.",
      );
    }
  }

  #takeResponseFrameId(): number {
    const frameId = this.#nextResponseFrameId;
    this.#nextResponseFrameId =
      frameId === MAX_FRAME_ID ? 1 : frameId + 1;
    return frameId;
  }
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyResult(): EndpointResult {
  return { responseFrames: [], diagnostics: [] };
}

function isBlockOperation(message: Message): message is AppliedBlockOperation {
  return (
    message.kind === "block.append" ||
    message.kind === "block.update" ||
    message.kind === "block.extend" ||
    message.kind === "block.replace_suffix" ||
    message.kind === "block.seal"
  );
}
