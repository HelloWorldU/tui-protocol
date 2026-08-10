import { parseStrictJson, StrictJsonError } from "./json.ts";

export const PROTOCOL_VERSION = 1 as const;

export const ERROR_CODES = [
  "invalid_message",
  "request_id_conflict",
  "context_not_open",
  "operation_id_reused",
  "block_id_reused",
  "block_not_found",
  "block_sealed",
  "unsupported_content_type",
  "invalid_content",
  "resource_exhausted",
  "internal_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ControlErrorCode =
  | "invalid_message"
  | "request_id_conflict"
  | "context_not_open"
  | "resource_exhausted"
  | "internal_error";

export type OperationErrorCode = Exclude<ErrorCode, "request_id_conflict">;

export interface Failure<Code extends ErrorCode = ErrorCode> {
  readonly code: Code;
  readonly message?: string;
}

export interface PlainTextSnapshot {
  readonly type: "text/plain";
  readonly data: string;
}

export type Message =
  | CapabilityQuery
  | CapabilityResponse
  | ContextOpen
  | ContextOpenResponse
  | ContextClose
  | ContextCloseResponse
  | BlockAppend
  | BlockUpdate
  | BlockSeal
  | ProtocolErrorMessage;

export interface CapabilityQuery {
  readonly version: 1;
  readonly kind: "capability.query";
  readonly request_id: string;
  readonly body: Record<string, never>;
}

export interface CapabilityResponse {
  readonly version: 1;
  readonly kind: "capability.response";
  readonly request_id: string;
  readonly body:
    | {
        readonly outcome: "supported";
        readonly optional_content_types: readonly string[];
      }
    | { readonly outcome: "unsupported" }
    | { readonly outcome: "error"; readonly error: Failure<ControlErrorCode> };
}

export interface ContextOpen {
  readonly version: 1;
  readonly kind: "context.open";
  readonly request_id: string;
  readonly body: Record<string, never>;
}

export type ContextOpenResponse =
  | {
      readonly version: 1;
      readonly kind: "context.open.response";
      readonly request_id: string;
      readonly context_id: string;
      readonly body: { readonly outcome: "opened" };
    }
  | {
      readonly version: 1;
      readonly kind: "context.open.response";
      readonly request_id: string;
      readonly body: {
        readonly outcome: "error";
        readonly error: Failure<ControlErrorCode>;
      };
    };

export interface ContextClose {
  readonly version: 1;
  readonly kind: "context.close";
  readonly request_id: string;
  readonly context_id: string;
  readonly body: Record<string, never>;
}

export interface ContextCloseResponse {
  readonly version: 1;
  readonly kind: "context.close.response";
  readonly request_id: string;
  readonly context_id: string;
  readonly body:
    | { readonly outcome: "closed" }
    | { readonly outcome: "error"; readonly error: Failure<ControlErrorCode> };
}

interface BlockOperationEnvelope {
  readonly version: 1;
  readonly operation_id: string;
  readonly context_id: string;
}

export interface BlockAppend extends BlockOperationEnvelope {
  readonly kind: "block.append";
  readonly body: {
    readonly block_id: string;
    readonly lifecycle: "mutable" | "sealed";
    readonly content: PlainTextSnapshot;
  };
}

export interface BlockUpdate extends BlockOperationEnvelope {
  readonly kind: "block.update";
  readonly body: {
    readonly block_id: string;
    readonly content: PlainTextSnapshot;
  };
}

export interface BlockSeal extends BlockOperationEnvelope {
  readonly kind: "block.seal";
  readonly body: { readonly block_id: string };
}

export interface ProtocolErrorMessage extends BlockOperationEnvelope {
  readonly kind: "protocol.error";
  readonly body: Failure<OperationErrorCode>;
}

const CONTROL_ERROR_CODES: readonly ControlErrorCode[] = [
  "invalid_message",
  "request_id_conflict",
  "context_not_open",
  "resource_exhausted",
  "internal_error",
];

const OPERATION_ERROR_CODES: readonly OperationErrorCode[] = ERROR_CODES.filter(
  (code): code is OperationErrorCode => code !== "request_id_conflict",
);

export type MessageCodecErrorCode =
  | "invalid_utf8"
  | "invalid_json"
  | "invalid_schema";

export class MessageCodecError extends Error {
  readonly code: MessageCodecErrorCode;

  constructor(code: MessageCodecErrorCode, message: string) {
    super(message);
    this.name = "MessageCodecError";
    this.code = code;
  }
}

const encoder = new TextEncoder();

export function serializeMessage(message: Message): Uint8Array {
  validateMessage(message);
  return encoder.encode(JSON.stringify(message));
}

export function deserializeMessage(bytes: Uint8Array): Message {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new MessageCodecError("invalid_utf8", "A UTF-8 BOM is forbidden.");
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    throw new MessageCodecError(
      "invalid_utf8",
      `Message is not valid UTF-8: ${toError(error).message}`,
    );
  }

  let decoded: unknown;
  try {
    decoded = parseStrictJson(source);
  } catch (error: unknown) {
    const detail =
      error instanceof StrictJsonError ? error.message : toError(error).message;
    throw new MessageCodecError("invalid_json", detail);
  }

  return validateMessage(decoded);
}

export function validateMessage(value: unknown): Message {
  try {
    return validateMessageInner(value);
  } catch (error: unknown) {
    if (error instanceof MessageCodecError) {
      throw error;
    }
    throw new MessageCodecError("invalid_schema", toError(error).message);
  }
}

function validateMessageInner(value: unknown): Message {
  const envelope = requireRecord(value, "Message");
  requireVersion(envelope.version);
  const kind = requireScalarString(envelope.kind, "Message.kind");
  const body = requireRecord(envelope.body, "Message.body");

  switch (kind) {
    case "capability.query":
      requireExactKeys(envelope, ["version", "kind", "request_id", "body"]);
      requireId(envelope.request_id, "Message.request_id");
      requireExactKeys(body, []);
      break;
    case "capability.response":
      requireExactKeys(envelope, ["version", "kind", "request_id", "body"]);
      requireId(envelope.request_id, "Message.request_id");
      validateCapabilityResponse(body);
      break;
    case "context.open":
      requireExactKeys(envelope, ["version", "kind", "request_id", "body"]);
      requireId(envelope.request_id, "Message.request_id");
      requireExactKeys(body, []);
      break;
    case "context.open.response":
      requireId(envelope.request_id, "Message.request_id");
      validateContextOpenResponse(envelope, body);
      break;
    case "context.close":
      requireExactKeys(envelope, [
        "version",
        "kind",
        "request_id",
        "context_id",
        "body",
      ]);
      requireId(envelope.request_id, "Message.request_id");
      requireId(envelope.context_id, "Message.context_id");
      requireExactKeys(body, []);
      break;
    case "context.close.response":
      requireExactKeys(envelope, [
        "version",
        "kind",
        "request_id",
        "context_id",
        "body",
      ]);
      requireId(envelope.request_id, "Message.request_id");
      requireId(envelope.context_id, "Message.context_id");
      validateOutcomeWithFailure(body, "closed", "Message.body");
      break;
    case "block.append":
      validateOperationEnvelope(envelope);
      requireExactKeys(body, ["block_id", "lifecycle", "content"]);
      requireId(body.block_id, "Message.body.block_id");
      if (body.lifecycle !== "mutable" && body.lifecycle !== "sealed") {
        invalid("Message.body.lifecycle must be mutable or sealed.");
      }
      validatePlainTextSnapshot(body.content, "Message.body.content");
      break;
    case "block.update":
      validateOperationEnvelope(envelope);
      requireExactKeys(body, ["block_id", "content"]);
      requireId(body.block_id, "Message.body.block_id");
      validatePlainTextSnapshot(body.content, "Message.body.content");
      break;
    case "block.seal":
      validateOperationEnvelope(envelope);
      requireExactKeys(body, ["block_id"]);
      requireId(body.block_id, "Message.body.block_id");
      break;
    case "protocol.error":
      validateOperationEnvelope(envelope);
      validateFailure(body, "Message.body", OPERATION_ERROR_CODES);
      break;
    default:
      invalid(`Unknown Message.kind ${JSON.stringify(kind)}.`);
  }

  return envelope as unknown as Message;
}

function validateCapabilityResponse(body: Record<string, unknown>): void {
  const outcome = requireScalarString(body.outcome, "Message.body.outcome");
  switch (outcome) {
    case "supported": {
      requireExactKeys(body, ["outcome", "optional_content_types"]);
      const values = body.optional_content_types;
      if (!Array.isArray(values)) {
        invalid("Message.body.optional_content_types must be an array.");
      }
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        const type = requireId(
          value,
          `Message.body.optional_content_types[${index}]`,
        );
        if (type === "text/plain") {
          invalid("Baseline text/plain must not be advertised as optional.");
        }
        if (seen.has(type)) {
          invalid(`Duplicate optional content type ${JSON.stringify(type)}.`);
        }
        seen.add(type);
      }
      return;
    }
    case "unsupported":
      requireExactKeys(body, ["outcome"]);
      return;
    case "error":
      requireExactKeys(body, ["outcome", "error"]);
      validateFailure(body.error, "Message.body.error", CONTROL_ERROR_CODES);
      return;
    default:
      invalid(`Unknown capability outcome ${JSON.stringify(outcome)}.`);
  }
}

function validateContextOpenResponse(
  envelope: Record<string, unknown>,
  body: Record<string, unknown>,
): void {
  const outcome = requireScalarString(body.outcome, "Message.body.outcome");
  if (outcome === "opened") {
    requireExactKeys(envelope, [
      "version",
      "kind",
      "request_id",
      "context_id",
      "body",
    ]);
    requireId(envelope.context_id, "Message.context_id");
    requireExactKeys(body, ["outcome"]);
    return;
  }
  if (outcome === "error") {
    requireExactKeys(envelope, ["version", "kind", "request_id", "body"]);
    requireExactKeys(body, ["outcome", "error"]);
    validateFailure(body.error, "Message.body.error", CONTROL_ERROR_CODES);
    return;
  }
  invalid(`Unknown context open outcome ${JSON.stringify(outcome)}.`);
}

function validateOutcomeWithFailure(
  body: Record<string, unknown>,
  success: string,
  context: string,
): void {
  const outcome = requireScalarString(body.outcome, `${context}.outcome`);
  if (outcome === success) {
    requireExactKeys(body, ["outcome"]);
    return;
  }
  if (outcome === "error") {
    requireExactKeys(body, ["outcome", "error"]);
    validateFailure(body.error, `${context}.error`, CONTROL_ERROR_CODES);
    return;
  }
  invalid(`Unknown ${context}.outcome ${JSON.stringify(outcome)}.`);
}

function validateOperationEnvelope(envelope: Record<string, unknown>): void {
  requireExactKeys(envelope, [
    "version",
    "kind",
    "operation_id",
    "context_id",
    "body",
  ]);
  requireId(envelope.operation_id, "Message.operation_id");
  requireId(envelope.context_id, "Message.context_id");
}

function validatePlainTextSnapshot(value: unknown, context: string): void {
  const snapshot = requireRecord(value, context);
  requireExactKeys(snapshot, ["type", "data"]);
  if (snapshot.type !== "text/plain") {
    invalid(`${context}.type must be text/plain in the baseline codec.`);
  }
  requireScalarString(snapshot.data, `${context}.data`);
}

function validateFailure(
  value: unknown,
  context: string,
  allowedCodes: readonly ErrorCode[],
): void {
  const failure = requireRecord(value, context);
  requireExactKeys(failure, ["code"], ["message"]);
  if (!allowedCodes.includes(failure.code as ErrorCode)) {
    invalid(`${context}.code is not permitted for this Message kind.`);
  }
  if (failure.message !== undefined) {
    requireScalarString(failure.message, `${context}.message`);
  }
}

function requireVersion(value: unknown): void {
  if (value !== PROTOCOL_VERSION) {
    invalid(`Message.version must be ${PROTOCOL_VERSION}.`);
  }
}

function requireId(value: unknown, context: string): string {
  const id = requireScalarString(value, context);
  if (id.length === 0) {
    invalid(`${context} must not be empty.`);
  }
  return id;
}

function requireScalarString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    invalid(`${context} must be a string.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) {
        invalid(`${context} contains an unpaired surrogate.`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid(`${context} contains an unpaired surrogate.`);
    }
  }
  return value;
}

function requireRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      invalid(`Unexpected field ${JSON.stringify(key)}.`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      invalid(`Missing required field ${JSON.stringify(key)}.`);
    }
  }
}

function invalid(message: string): never {
  throw new MessageCodecError("invalid_schema", message);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
