import {
  ProtocolStreamDecoder,
  encodeMessageFrames,
  type DecoderEvent,
  type Message,
} from "../../reference-codec/index.ts";
import {
  ProtocolSessionError,
  TerminalProtocolSession,
  type SessionContextSnapshot,
} from "../../protocol-session/index.ts";

const MAX_FRAME_ID = 2_147_483_647;

export interface TerminalProtocolEndpointOptions {
  readonly completeBaselineSupported: boolean;
}

export interface EndpointDiagnostic {
  readonly layer: "framing" | "message" | "session";
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
  #nextResponseFrameId = 1;
  #ended = false;

  constructor(options: TerminalProtocolEndpointOptions) {
    this.#session = new TerminalProtocolSession(options);
  }

  push(bytes: Uint8Array): EndpointResult {
    if (this.#ended) {
      throw new ProtocolEndpointError(
        "Protocol endpoint cannot receive bytes after its connection ends.",
      );
    }
    return this.#process(this.#decoder.push(bytes));
  }

  finish(): EndpointResult {
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

  #process(events: readonly DecoderEvent[]): EndpointResult {
    const responseFrames: Uint8Array[] = [];
    const diagnostics: EndpointDiagnostic[] = [];

    for (const event of events) {
      let responses: readonly Message[];
      if (event.type === "error") {
        diagnostics.push({ layer: event.layer, reason: event.reason });
        if (event.identity === undefined) {
          continue;
        }
        responses = this.#session.handleInvalidMessage(event.identity);
      } else {
        try {
          responses = this.#session.handle(event.message);
        } catch (error: unknown) {
          if (!(error instanceof ProtocolSessionError)) {
            throw error;
          }
          diagnostics.push({ layer: "session", reason: error.message });
          continue;
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

  #takeResponseFrameId(): number {
    const frameId = this.#nextResponseFrameId;
    this.#nextResponseFrameId =
      frameId === MAX_FRAME_ID ? 1 : frameId + 1;
    return frameId;
  }
}

function emptyResult(): EndpointResult {
  return { responseFrames: [], diagnostics: [] };
}
