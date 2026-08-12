import type {
  BlockAppend,
  BlockSeal,
  BlockUpdate,
  ContextClose,
  InvalidMessageIdentity,
  Message,
  OperationErrorCode,
  PlainTextSnapshot,
} from "../reference-codec/message.ts";

type ControlRequest = Extract<
  Message,
  { readonly kind: "capability.query" | "context.open" | "context.close" }
>;

type BlockOperation = BlockAppend | BlockUpdate | BlockSeal;

interface StoredBlock {
  readonly id: string;
  lifecycle: "mutable" | "sealed";
  content: PlainTextSnapshot;
}

interface StoredContext {
  readonly id: string;
  state: "open" | "closed";
  readonly blocks: StoredBlock[];
  readonly blockIds: Set<string>;
  readonly operationIds: Set<string>;
}

interface StoredControlResult {
  readonly fingerprint: string;
  readonly response: Message;
}

export interface SessionBlockSnapshot {
  readonly id: string;
  readonly lifecycle: "mutable" | "sealed";
  readonly content: PlainTextSnapshot;
}

export interface SessionContextSnapshot {
  readonly id: string;
  readonly state: "open" | "closed";
  readonly blocks: readonly SessionBlockSnapshot[];
}

export interface TerminalProtocolSessionOptions {
  readonly completeBaselineSupported: boolean;
}

export class ProtocolSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolSessionError";
  }
}

export class TerminalProtocolSession {
  readonly #contexts = new Map<string, StoredContext>();
  readonly #controlResults = new Map<string, StoredControlResult>();
  readonly #completeBaselineSupported: boolean;
  #nextContextId = 1;
  #ended = false;

  constructor(options: TerminalProtocolSessionOptions) {
    this.#completeBaselineSupported = options.completeBaselineSupported;
  }

  handle(message: Message): readonly Message[] {
    if (this.#ended) {
      throw new ProtocolSessionError(
        "Terminal session cannot receive Messages after its connection ends.",
      );
    }

    switch (message.kind) {
      case "capability.query":
      case "context.open":
      case "context.close":
        return [this.#handleControl(message)];
      case "block.append":
      case "block.update":
      case "block.seal":
        return this.#handleOperation(message);
      case "capability.response":
      case "context.open.response":
      case "context.close.response":
      case "protocol.error":
        throw new ProtocolSessionError(
          `Terminal session cannot receive ${JSON.stringify(message.kind)}.`,
        );
      default:
        return assertNever(message);
    }
  }

  handleInvalidMessage(identity: InvalidMessageIdentity): readonly Message[] {
    if (this.#ended) {
      throw new ProtocolSessionError(
        "Terminal session cannot receive Messages after its connection ends.",
      );
    }
    return identity.category === "control"
      ? [this.#handleInvalidControl(identity)]
      : [this.#handleInvalidOperation(identity)];
  }

  context(id: string): SessionContextSnapshot | undefined {
    const context = this.#contexts.get(id);
    return context === undefined ? undefined : snapshotContext(context);
  }

  contexts(): readonly SessionContextSnapshot[] {
    return [...this.#contexts.values()].map(snapshotContext);
  }

  endConnection(): void {
    if (this.#ended) {
      return;
    }
    for (const context of this.#contexts.values()) {
      closeStoredContext(context);
    }
    this.#ended = true;
  }

  #handleControl(request: ControlRequest): Message {
    const fingerprint = controlFingerprint(request);
    const previous = this.#controlResults.get(request.request_id);
    if (previous !== undefined) {
      return cloneMessage(
        previous.fingerprint === fingerprint
          ? previous.response
          : controlError(request, "request_id_conflict"),
      );
    }

    const response = this.#executeControl(request);
    this.#controlResults.set(request.request_id, { fingerprint, response });
    return cloneMessage(response);
  }

  #handleInvalidControl(
    identity: Extract<InvalidMessageIdentity, { readonly category: "control" }>,
  ): Message {
    const previous = this.#controlResults.get(identity.request_id);
    if (previous !== undefined) {
      return cloneMessage(
        previous.fingerprint === identity.fingerprint
          ? previous.response
          : invalidControlError(identity, "request_id_conflict"),
      );
    }

    const response = invalidControlError(identity, "invalid_message");
    this.#controlResults.set(identity.request_id, {
      fingerprint: identity.fingerprint,
      response,
    });
    return cloneMessage(response);
  }

  #handleInvalidOperation(
    identity: Extract<
      InvalidMessageIdentity,
      { readonly category: "operation" }
    >,
  ): Message {
    const context = this.#contexts.get(identity.context_id);
    if (context !== undefined && context.state === "open") {
      if (context.operationIds.has(identity.operation_id)) {
        return invalidOperationError(identity, "operation_id_reused");
      }
      context.operationIds.add(identity.operation_id);
    }
    return invalidOperationError(identity, "invalid_message");
  }

  #executeControl(request: ControlRequest): Message {
    switch (request.kind) {
      case "capability.query":
        return this.#completeBaselineSupported
          ? {
              version: 1,
              kind: "capability.response",
              request_id: request.request_id,
              body: { outcome: "supported", optional_content_types: [] },
            }
          : {
              version: 1,
              kind: "capability.response",
              request_id: request.request_id,
              body: { outcome: "unsupported" },
            };
      case "context.open": {
        const id = `context-${this.#nextContextId}`;
        this.#nextContextId += 1;
        this.#contexts.set(id, {
          id,
          state: "open",
          blocks: [],
          blockIds: new Set(),
          operationIds: new Set(),
        });
        return {
          version: 1,
          kind: "context.open.response",
          request_id: request.request_id,
          context_id: id,
          body: { outcome: "opened" },
        };
      }
      case "context.close":
        return this.#closeContext(request);
      default:
        return assertNever(request);
    }
  }

  #closeContext(request: ContextClose): Message {
    const context = this.#contexts.get(request.context_id);
    if (context === undefined) {
      return controlError(request, "context_not_open");
    }

    closeStoredContext(context);

    return {
      version: 1,
      kind: "context.close.response",
      request_id: request.request_id,
      context_id: request.context_id,
      body: { outcome: "closed" },
    };
  }

  #handleOperation(operation: BlockOperation): readonly Message[] {
    const context = this.#contexts.get(operation.context_id);
    if (context === undefined || context.state !== "open") {
      return [operationError(operation, "context_not_open")];
    }
    if (context.operationIds.has(operation.operation_id)) {
      return [operationError(operation, "operation_id_reused")];
    }

    // Operation identity is consumed even when semantic evaluation rejects the
    // operation. A corrected operation must use a fresh identity.
    context.operationIds.add(operation.operation_id);

    const error = this.#executeOperation(context, operation);
    return error === undefined ? [] : [operationError(operation, error)];
  }

  #executeOperation(
    context: StoredContext,
    operation: BlockOperation,
  ): OperationErrorCode | undefined {
    switch (operation.kind) {
      case "block.append":
        if (context.blockIds.has(operation.body.block_id)) {
          return "block_id_reused";
        }
        context.blockIds.add(operation.body.block_id);
        context.blocks.push({
          id: operation.body.block_id,
          lifecycle: operation.body.lifecycle,
          content: cloneContent(operation.body.content),
        });
        return undefined;
      case "block.update": {
        const block = findBlock(context, operation.body.block_id);
        if (block === undefined) {
          return "block_not_found";
        }
        if (block.lifecycle === "sealed") {
          return "block_sealed";
        }
        block.content = cloneContent(operation.body.content);
        return undefined;
      }
      case "block.seal": {
        const block = findBlock(context, operation.body.block_id);
        if (block === undefined) {
          return "block_not_found";
        }
        if (block.lifecycle === "sealed") {
          return "block_sealed";
        }
        block.lifecycle = "sealed";
        return undefined;
      }
      default:
        return assertNever(operation);
    }
  }
}

function controlFingerprint(request: ControlRequest): string {
  return request.kind === "context.close"
    ? `valid:${request.version}:${request.kind}:${request.context_id}`
    : `valid:${request.version}:${request.kind}`;
}

function invalidControlError(
  identity: Extract<InvalidMessageIdentity, { readonly category: "control" }>,
  code: "invalid_message" | "request_id_conflict",
): Message {
  const error = { code } as const;
  switch (identity.kind) {
    case "capability.query":
      return {
        version: 1,
        kind: "capability.response",
        request_id: identity.request_id,
        body: { outcome: "error", error },
      };
    case "context.open":
      return {
        version: 1,
        kind: "context.open.response",
        request_id: identity.request_id,
        body: { outcome: "error", error },
      };
    case "context.close":
      return {
        version: 1,
        kind: "context.close.response",
        request_id: identity.request_id,
        context_id: identity.context_id,
        body: { outcome: "error", error },
      };
    default:
      return assertNever(identity);
  }
}

function invalidOperationError(
  identity: Extract<InvalidMessageIdentity, { readonly category: "operation" }>,
  code: "invalid_message" | "operation_id_reused",
): Message {
  return {
    version: 1,
    kind: "protocol.error",
    operation_id: identity.operation_id,
    context_id: identity.context_id,
    body: { code },
  };
}

function controlError(
  request: ControlRequest,
  code: "request_id_conflict" | "context_not_open",
): Message {
  const error = { code } as const;
  switch (request.kind) {
    case "capability.query":
      return {
        version: 1,
        kind: "capability.response",
        request_id: request.request_id,
        body: { outcome: "error", error },
      };
    case "context.open":
      return {
        version: 1,
        kind: "context.open.response",
        request_id: request.request_id,
        body: { outcome: "error", error },
      };
    case "context.close":
      return {
        version: 1,
        kind: "context.close.response",
        request_id: request.request_id,
        context_id: request.context_id,
        body: { outcome: "error", error },
      };
    default:
      return assertNever(request);
  }
}

function operationError(
  operation: BlockOperation,
  code: OperationErrorCode,
): Message {
  return {
    version: 1,
    kind: "protocol.error",
    operation_id: operation.operation_id,
    context_id: operation.context_id,
    body: { code },
  };
}

function findBlock(
  context: StoredContext,
  blockId: string,
): StoredBlock | undefined {
  return context.blocks.find((block) => block.id === blockId);
}

function closeStoredContext(context: StoredContext): void {
  if (context.state === "closed") {
    return;
  }
  for (const block of context.blocks) {
    block.lifecycle = "sealed";
  }
  context.state = "closed";
}

function snapshotContext(context: StoredContext): SessionContextSnapshot {
  return {
    id: context.id,
    state: context.state,
    blocks: context.blocks.map((block) => ({
      id: block.id,
      lifecycle: block.lifecycle,
      content: cloneContent(block.content),
    })),
  };
}

function cloneContent(content: PlainTextSnapshot): PlainTextSnapshot {
  return { type: "text/plain", data: content.data };
}

function cloneMessage(message: Message): Message {
  return structuredClone(message);
}

function assertNever(value: never): never {
  throw new ProtocolSessionError(
    `Unexpected Message: ${JSON.stringify(value)}`,
  );
}
