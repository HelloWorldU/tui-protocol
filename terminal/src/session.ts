import type {
  BlockAppend,
  BlockExtend,
  BlockReplaceSuffix,
  BlockSeal,
  BlockUpdate,
  ContextClose,
  InvalidMessageIdentity,
  Message,
  OperationErrorCode,
  PlainTextSnapshot,
} from "@tui-protocol/protocol";
import { validateSessionLimits, type SessionResourceLimits } from "./resource-limits.ts";

type ControlRequest = Extract<
  Message,
  { readonly kind: "capability.query" | "context.open" | "context.close" }
>;

export type BlockOperation =
  | BlockAppend
  | BlockUpdate
  | BlockExtend
  | BlockReplaceSuffix
  | BlockSeal;

export type OperationExecutionErrorCode = Extract<
  OperationErrorCode,
  "resource_exhausted" | "internal_error"
>;

export type OperationPreparation =
  | {
      readonly status: "rejected";
      readonly responses: readonly Message[];
    }
  | {
      readonly status: "prepared";
      readonly operation: BlockOperation;
      commit(): readonly Message[];
      reject(code: OperationExecutionErrorCode): readonly Message[];
    };

interface StoredBlock {
  readonly id: string;
  lifecycle: "mutable" | "sealed";
  content: PlainTextSnapshot;
  contentOperationId: string;
}

interface StoredContext {
  readonly id: string;
  state: "open" | "closed" | "invalidated";
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
  readonly state: "open" | "closed" | "invalidated";
  readonly blocks: readonly SessionBlockSnapshot[];
}

export interface TerminalProtocolSessionOptions {
  readonly completeBaselineSupported: boolean;
  readonly resourceLimits?: SessionResourceLimits;
}

export class ProtocolSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolSessionError";
  }
}

export class SessionResourceLimitError extends ProtocolSessionError {}

export class TerminalProtocolSession {
  readonly #contexts = new Map<string, StoredContext>();
  readonly #controlResults = new Map<string, StoredControlResult>();
  readonly #completeBaselineSupported: boolean;
  #pendingOperation: object | undefined = undefined;
  #nextContextId = 1;
  #ended = false;
  readonly #limits: SessionResourceLimits | undefined;
  #resourceFailure: SessionResourceLimitError | undefined;
  #contentUnits = 0;
  #blockCount = 0;
  #operationCount = 0;
  #fingerprintUnits = 0;

  constructor(options: TerminalProtocolSessionOptions) {
    this.#completeBaselineSupported = options.completeBaselineSupported;
    this.#limits = options.resourceLimits && validateSessionLimits(options.resourceLimits);
  }

  handle(message: Message): readonly Message[] {
    this.#assertCanProcess();

    switch (message.kind) {
      case "capability.query":
      case "context.open":
      case "context.close":
        return [this.#handleControl(message)];
      case "block.append":
      case "block.update":
      case "block.extend":
      case "block.replace_suffix":
      case "block.seal": {
        const preparation = this.#prepareOperation(message);
        return preparation.status === "rejected"
          ? preparation.responses
          : preparation.commit();
      }
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
    this.#assertCanProcess();
    return identity.category === "control"
      ? [this.#handleInvalidControl(identity)]
      : [this.#handleInvalidOperation(identity)];
  }

  prepareOperation(operation: BlockOperation): OperationPreparation {
    this.#assertCanProcess();
    return this.#prepareOperation(operation);
  }

  context(id: string): SessionContextSnapshot | undefined {
    const context = this.#contexts.get(id);
    return context === undefined ? undefined : snapshotContext(context);
  }

  contexts(): readonly SessionContextSnapshot[] {
    return [...this.#contexts.values()].map(snapshotContext);
  }

  /**
   * Host-side integrity boundary for frame-external terminal traffic that has
   * made one Context's rendered Block mapping unreliable. It is not a
   * protocol Message and produces no response.
   */
  invalidateContext(id: string): boolean {
    this.#assertCanProcess();
    const context = this.#contexts.get(id);
    if (context === undefined || context.state !== "open") {
      return false;
    }
    context.state = "invalidated";
    return true;
  }

  endConnection(): void {
    if (this.#resourceFailure) throw this.#resourceFailure;
    if (this.#ended) {
      return;
    }
    // A disconnected peer cannot receive a result for an uncommitted
    // Operation. Discard it before closing the Contexts so its preparation
    // cannot mutate state afterward.
    this.#pendingOperation = undefined;
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

    this.#reserveControl(request.request_id, fingerprint);
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

    this.#reserveControl(identity.request_id, identity.fingerprint);
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
      this.#reserveOperation(identity.operation_id);
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
        if (this.#limits && this.#contexts.size >= this.#limits.maxContexts) this.#exhaust("Context records");
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
    if (context === undefined || context.state === "invalidated") {
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

  #prepareOperation(operation: BlockOperation): OperationPreparation {
    const snapshot = cloneOperation(operation);
    const context = this.#contexts.get(snapshot.context_id);
    if (context === undefined || context.state !== "open") {
      return rejectedPreparation(snapshot, "context_not_open");
    }
    if (context.operationIds.has(snapshot.operation_id)) {
      return rejectedPreparation(snapshot, "operation_id_reused");
    }

    // Operation identity is consumed even when semantic evaluation rejects the
    // operation. A corrected operation must use a fresh identity.
    this.#reserveOperation(snapshot.operation_id);
    if (this.#limits && snapshot.body.block_id.length > this.#limits.maxIdentifierCodeUnits) this.#exhaust("Block ID length");
    context.operationIds.add(snapshot.operation_id);

    const error = this.#validateOperation(context, snapshot);
    if (error !== undefined) {
      return rejectedPreparation(snapshot, error);
    }

    const oldUnits = findBlock(context, snapshot.body.block_id)?.content.data.length ?? 0;
    const nextUnits = projectedUnits(context, snapshot);
    if (this.#limits && (nextUnits > this.#limits.maxBlockCodeUnits ||
        this.#contentUnits - oldUnits + nextUnits > this.#limits.maxTotalContentCodeUnits ||
        (snapshot.kind === "block.append" && this.#blockCount >= this.#limits.maxBlocks))) {
      return rejectedPreparation(snapshot, "resource_exhausted");
    }

    const token = {};
    this.#pendingOperation = token;
    let settled = false;
    const assertPending = (): void => {
      if (settled || this.#pendingOperation !== token) {
        throw new ProtocolSessionError(
          "Prepared Operation is no longer active.",
        );
      }
    };
    const settle = (): void => {
      assertPending();
      settled = true;
      this.#pendingOperation = undefined;
    };

    return {
      status: "prepared",
      operation: cloneOperation(snapshot),
      commit: () => {
        assertPending();
        try {
          const committed = this.#buildCommittedContext(context, snapshot);
          this.#contexts.set(context.id, committed);
          this.#contentUnits += nextUnits - oldUnits;
          if (snapshot.kind === "block.append") this.#blockCount++;
          return [];
        } catch {
          return [operationError(snapshot, "internal_error")];
        } finally {
          settled = true;
          this.#pendingOperation = undefined;
        }
      },
      reject: (code) => {
        settle();
        return [operationError(snapshot, code)];
      },
    };
  }

  #validateOperation(
    context: StoredContext,
    operation: BlockOperation,
  ): OperationErrorCode | undefined {
    switch (operation.kind) {
      case "block.append":
        if (context.blockIds.has(operation.body.block_id)) {
          return "block_id_reused";
        }
        return undefined;
      case "block.update": {
        const block = findBlock(context, operation.body.block_id);
        if (block === undefined) {
          return "block_not_found";
        }
        if (block.lifecycle === "sealed") {
          return "block_sealed";
        }
        return undefined;
      }
      case "block.extend": {
        const block = findBlock(context, operation.body.block_id);
        if (block === undefined) {
          return "block_not_found";
        }
        if (block.lifecycle === "sealed") {
          return "block_sealed";
        }
        if (block.contentOperationId !== operation.body.base_operation_id) {
          return "content_state_mismatch";
        }
        return undefined;
      }
      case "block.replace_suffix": {
        const block = findBlock(context, operation.body.block_id);
        if (block === undefined) {
          return "block_not_found";
        }
        if (block.lifecycle === "sealed") {
          return "block_sealed";
        }
        if (block.contentOperationId !== operation.body.base_operation_id) {
          return "content_state_mismatch";
        }
        if (operation.body.retain >= unicodeScalarLength(block.content.data)) {
          return "invalid_content_boundary";
        }
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
        return undefined;
      }
      default:
        return assertNever(operation);
    }
  }

  #buildCommittedContext(
    context: StoredContext,
    operation: BlockOperation,
  ): StoredContext {
    let blocks: StoredBlock[];
    const blockIds = new Set(context.blockIds);

    switch (operation.kind) {
      case "block.append":
        blocks = [
          ...context.blocks,
          {
            id: operation.body.block_id,
            lifecycle: operation.body.lifecycle,
            content: cloneContent(operation.body.content),
            contentOperationId: operation.operation_id,
          },
        ];
        blockIds.add(operation.body.block_id);
        break;
      case "block.update":
        blocks = replaceBlock(context, operation.body.block_id, (block) => ({
          ...block,
          content: cloneContent(operation.body.content),
          contentOperationId: operation.operation_id,
        }));
        break;
      case "block.extend":
        blocks = replaceBlock(context, operation.body.block_id, (block) => ({
          ...block,
          content: {
            type: "text/plain",
            data: `${block.content.data}${operation.body.fragment}`,
          },
          contentOperationId: operation.operation_id,
        }));
        break;
      case "block.replace_suffix":
        blocks = replaceBlock(context, operation.body.block_id, (block) => ({
          ...block,
          content: {
            type: "text/plain",
            data: replaceSuffix(
              block.content.data,
              operation.body.retain,
              operation.body.replacement,
            ),
          },
          contentOperationId: operation.operation_id,
        }));
        break;
      case "block.seal":
        blocks = replaceBlock(context, operation.body.block_id, (block) => ({
          ...block,
          lifecycle: "sealed",
        }));
        break;
      default:
        return assertNever(operation);
    }

    return {
      id: context.id,
      state: context.state,
      blocks,
      blockIds,
      operationIds: new Set(context.operationIds),
    };
  }

  #assertCanProcess(): void {
    if (this.#resourceFailure) throw this.#resourceFailure;
    if (this.#ended) {
      throw new ProtocolSessionError(
        "Terminal session cannot receive Messages after its connection ends.",
      );
    }
    if (this.#pendingOperation !== undefined) {
      throw new ProtocolSessionError(
        "Terminal session cannot process another Message while an Operation is prepared.",
      );
    }
  }

  #exhaust(resource: string): never {
    this.#resourceFailure ??= new SessionResourceLimitError(`Local session budget exhausted: ${resource}`);
    this.#pendingOperation = undefined;
    throw this.#resourceFailure;
  }

  #reserveOperation(operationId: string) {
    if (this.#limits && (operationId.length > this.#limits.maxIdentifierCodeUnits ||
        this.#operationCount >= this.#limits.maxOperationIds)) {
      this.#exhaust("Operation identity records");
    }
    this.#operationCount++;
  }

  #reserveControl(requestId: string, fingerprint: string) {
    if (this.#limits && (requestId.length > this.#limits.maxIdentifierCodeUnits ||
        this.#controlResults.size >= this.#limits.maxControlResults ||
        this.#fingerprintUnits + fingerprint.length > this.#limits.maxControlFingerprintCodeUnits)) {
      this.#exhaust("Control replay records");
    }
    this.#fingerprintUnits += fingerprint.length;
  }
}

function projectedUnits(context: StoredContext, operation: BlockOperation): number {
  switch (operation.kind) {
    case "block.append": case "block.update": return operation.body.content.data.length;
    case "block.extend": return findBlock(context, operation.body.block_id)!.content.data.length + operation.body.fragment.length;
    case "block.replace_suffix": {
      const text = findBlock(context, operation.body.block_id)!.content.data;
      let scalars = 0, units = 0;
      for (const scalar of text) { if (scalars++ >= operation.body.retain) break; units += scalar.length; }
      return units + operation.body.replacement.length;
    }
    case "block.seal": return findBlock(context, operation.body.block_id)!.content.data.length;
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

function rejectedPreparation(
  operation: BlockOperation,
  code: OperationErrorCode,
): OperationPreparation {
  return {
    status: "rejected",
    responses: [operationError(operation, code)],
  };
}

function findBlock(
  context: StoredContext,
  blockId: string,
): StoredBlock | undefined {
  return context.blocks.find((block) => block.id === blockId);
}

function replaceBlock(
  context: StoredContext,
  blockId: string,
  replacement: (block: StoredBlock) => StoredBlock,
): StoredBlock[] {
  let replaced = false;
  const blocks = context.blocks.map((block) => {
    if (block.id !== blockId) {
      return block;
    }
    replaced = true;
    return replacement(block);
  });
  if (!replaced) {
    throw new ProtocolSessionError(
      `Prepared Block ${JSON.stringify(blockId)} no longer exists.`,
    );
  }
  return blocks;
}

function closeStoredContext(context: StoredContext): void {
  if (context.state !== "open") {
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

function unicodeScalarLength(value: string): number {
  return Array.from(value).length;
}

function replaceSuffix(
  value: string,
  retain: number,
  replacement: string,
): string {
  return `${Array.from(value).slice(0, retain).join("")}${replacement}`;
}

function cloneOperation(operation: BlockOperation): BlockOperation {
  return structuredClone(operation);
}

function cloneMessage(message: Message): Message {
  return structuredClone(message);
}

function assertNever(value: never): never {
  throw new ProtocolSessionError(
    `Unexpected Message: ${JSON.stringify(value)}`,
  );
}
