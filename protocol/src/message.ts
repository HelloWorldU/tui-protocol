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
  "content_state_mismatch",
  "invalid_content_boundary",
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

export type StyledTextColor =
  | "default"
  | { readonly palette: number }
  | { readonly rgb: readonly [number, number, number] };

export interface StyledTextStyle {
  readonly foreground?: StyledTextColor;
  readonly background?: StyledTextColor;
  readonly bold?: boolean;
  readonly faint?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
  readonly inverse?: boolean;
}

export interface StyledTextSpan {
  readonly text: string;
  readonly style?: StyledTextStyle;
}

export interface StyledTextSnapshot {
  readonly type: "text/styled";
  readonly data: readonly StyledTextSpan[];
}

/** One text/lines line (experimental, RFC 0003): styled text plus layout attributes. */
export interface LinesTextLine {
  readonly spans: readonly StyledTextSpan[];
  readonly wrap?: "word" | "char";
  readonly continuation?: readonly StyledTextSpan[];
  readonly fill?: true;
}

export interface LinesTextSnapshot {
  readonly type: "text/lines";
  readonly data: readonly LinesTextLine[];
}

export type ContentSnapshot = PlainTextSnapshot | StyledTextSnapshot | LinesTextSnapshot;

/** An Extend fragment or ReplaceSuffix replacement: text, spans, or lines by the Block's type. */
export type ContentFragment = string | readonly StyledTextSpan[] | readonly LinesTextLine[];

export type Message =
  | CapabilityQuery
  | CapabilityResponse
  | ContextOpen
  | ContextOpenResponse
  | ContextClose
  | ContextCloseResponse
  | BlockAppend
  | BlockUpdate
  | BlockExtend
  | BlockReplaceSuffix
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
    readonly content: ContentSnapshot;
  };
}

export interface BlockUpdate extends BlockOperationEnvelope {
  readonly kind: "block.update";
  readonly body: {
    readonly block_id: string;
    readonly content: ContentSnapshot;
  };
}

export interface BlockExtend extends BlockOperationEnvelope {
  readonly kind: "block.extend";
  readonly body: {
    readonly block_id: string;
    readonly base_operation_id: string;
    readonly fragment: ContentFragment;
  };
}

export interface BlockReplaceSuffix extends BlockOperationEnvelope {
  readonly kind: "block.replace_suffix";
  readonly body: {
    readonly block_id: string;
    readonly base_operation_id: string;
    readonly retain: number;
    readonly replacement: ContentFragment;
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

export type InvalidMessageIdentity =
  | {
      readonly category: "control";
      readonly kind: "capability.query" | "context.open";
      readonly request_id: string;
      readonly fingerprint: string;
    }
  | {
      readonly category: "control";
      readonly kind: "context.close";
      readonly request_id: string;
      readonly context_id: string;
      readonly fingerprint: string;
    }
  | {
      readonly category: "operation";
      readonly kind:
        | "block.append"
        | "block.update"
        | "block.extend"
        | "block.replace_suffix"
        | "block.seal";
      readonly operation_id: string;
      readonly context_id: string;
    };

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
  readonly identity: InvalidMessageIdentity | undefined;

  constructor(
    code: MessageCodecErrorCode,
    message: string,
    identity?: InvalidMessageIdentity,
  ) {
    super(message);
    this.name = "MessageCodecError";
    this.code = code;
    this.identity = identity;
  }
}

const encoder = new TextEncoder();

export function serializeMessage(message: Message): Uint8Array {
  let snapshot: unknown;
  try {
    snapshot = structuredClone(message);
  } catch (error: unknown) {
    throw new MessageCodecError(
      "invalid_schema",
      `Message cannot be snapshotted: ${toError(error).message}`,
    );
  }

  return encoder.encode(stringifyJsonValue(validateMessage(snapshot)));
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

  try {
    return validateMessage(decoded);
  } catch (error: unknown) {
    if (
      error instanceof MessageCodecError &&
      error.code === "invalid_schema"
    ) {
      throw new MessageCodecError(
        error.code,
        error.message,
        identifyInvalidMessage(decoded),
      );
    }
    throw error;
  }
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
      validateContentSnapshot(body.content, "Message.body.content");
      break;
    case "block.update":
      validateOperationEnvelope(envelope);
      requireExactKeys(body, ["block_id", "content"]);
      requireId(body.block_id, "Message.body.block_id");
      validateContentSnapshot(body.content, "Message.body.content");
      break;
    case "block.extend":
      validateOperationEnvelope(envelope);
      requireExactKeys(body, ["block_id", "base_operation_id", "fragment"]);
      requireId(body.block_id, "Message.body.block_id");
      requireId(
        body.base_operation_id,
        "Message.body.base_operation_id",
      );
      if (typeof body.fragment === "string") {
        requireNonEmptyString(body.fragment, "Message.body.fragment");
      } else {
        validateFragmentArray(body.fragment, "Message.body.fragment", false);
      }
      break;
    case "block.replace_suffix":
      validateOperationEnvelope(envelope);
      requireExactKeys(body, [
        "block_id",
        "base_operation_id",
        "retain",
        "replacement",
      ]);
      requireId(body.block_id, "Message.body.block_id");
      requireId(
        body.base_operation_id,
        "Message.body.base_operation_id",
      );
      requireSafeNonNegativeInteger(body.retain, "Message.body.retain");
      if (typeof body.replacement === "string") {
        requireScalarString(body.replacement, "Message.body.replacement");
      } else {
        validateFragmentArray(body.replacement, "Message.body.replacement", true);
      }
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

function validateContentSnapshot(value: unknown, context: string): void {
  const snapshot = requireRecord(value, context);
  requireExactKeys(snapshot, ["type", "data"]);
  const type = requireScalarString(snapshot.type, `${context}.type`);
  if (type === "text/plain") {
    requireScalarString(snapshot.data, `${context}.data`);
    return;
  }
  if (type === "text/styled") {
    // The codec checks span structure only; content-validity rules such as
    // non-empty span text and known style attributes are content semantics,
    // enforced by the terminal as invalid_content.
    validateSpanArray(snapshot.data, `${context}.data`, true);
    return;
  }
  if (type === "text/lines") {
    validateLineArray(snapshot.data, `${context}.data`, true);
    return;
  }
  invalid(`${context}.type must be text/plain, text/styled, or text/lines in this codec.`);
}

/** A non-string fragment is a line array when its first element has `spans`, else a span array. */
function validateFragmentArray(value: unknown, context: string, allowEmpty: boolean): void {
  if (Array.isArray(value) && isLineRecord(value[0])) {
    validateLineArray(value, context, allowEmpty);
  } else {
    validateSpanArray(value, context, allowEmpty);
  }
}

function isLineRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "spans" in value;
}

function validateLineArray(value: unknown, context: string, allowEmpty: boolean): void {
  if (!Array.isArray(value)) {
    invalid(`${context} must be an array of lines.`);
  }
  if (!allowEmpty && value.length === 0) {
    invalid(`${context} must not be empty.`);
  }
  for (const [index, item] of value.entries()) {
    const line = requireRecord(item, `${context}[${index}]`);
    requireExactKeys(line, ["spans"], ["wrap", "continuation", "fill"]);
    validateSpanArray(line.spans, `${context}[${index}].spans`, true);
    if (line.wrap !== undefined) {
      requireScalarString(line.wrap, `${context}[${index}].wrap`);
    }
    if (line.continuation !== undefined) {
      validateSpanArray(line.continuation, `${context}[${index}].continuation`, true);
    }
    if (line.fill !== undefined && typeof line.fill !== "boolean") {
      invalid(`${context}[${index}].fill must be a boolean.`);
    }
  }
}

function validateSpanArray(
  value: unknown,
  context: string,
  allowEmpty: boolean,
): void {
  if (!Array.isArray(value)) {
    invalid(`${context} must be an array of spans.`);
  }
  if (!allowEmpty && value.length === 0) {
    invalid(`${context} must not be empty.`);
  }
  for (const [index, item] of value.entries()) {
    const span = requireRecord(item, `${context}[${index}]`);
    requireExactKeys(span, ["text"], ["style"]);
    requireScalarString(span.text, `${context}[${index}].text`);
    if (span.style !== undefined) {
      requireRecord(span.style, `${context}[${index}].style`);
    }
  }
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
  return requireNonEmptyString(value, context);
}

function requireNonEmptyString(value: unknown, context: string): string {
  const id = requireScalarString(value, context);
  if (id.length === 0) {
    invalid(`${context} must not be empty.`);
  }
  return id;
}

function requireSafeNonNegativeInteger(
  value: unknown,
  context: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(`${context} must be an integer from 0 through 9007199254740991.`);
  }
  return value as number;
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

function identifyInvalidMessage(
  value: unknown,
): InvalidMessageIdentity | undefined {
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION) {
    return undefined;
  }
  const kind = reliableId(value.kind);
  if (kind === undefined) {
    return undefined;
  }

  switch (kind) {
    case "capability.query":
    case "context.open": {
      const requestId = reliableId(value.request_id);
      return requestId === undefined
        ? undefined
        : {
            category: "control",
            kind,
            request_id: requestId,
            fingerprint: `invalid:${canonicalJson(value)}`,
          };
    }
    case "context.close": {
      const requestId = reliableId(value.request_id);
      const contextId = reliableId(value.context_id);
      return requestId === undefined || contextId === undefined
        ? undefined
        : {
            category: "control",
            kind,
            request_id: requestId,
            context_id: contextId,
            fingerprint: `invalid:${canonicalJson(value)}`,
          };
    }
    case "block.append":
    case "block.update":
    case "block.extend":
    case "block.replace_suffix":
    case "block.seal": {
      const operationId = reliableId(value.operation_id);
      const contextId = reliableId(value.context_id);
      return operationId === undefined || contextId === undefined
        ? undefined
        : {
            category: "operation",
            kind,
            operation_id: operationId,
            context_id: contextId,
          };
    }
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reliableId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  try {
    return requireScalarString(value, "Message identity");
  } catch {
    return undefined;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${quoteJsonString(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function invalid(message: string): never {
  throw new MessageCodecError("invalid_schema", message);
}

function stringifyJsonValue(value: unknown): string {
  if (typeof value === "string") {
    return quoteJsonString(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      invalid("Message contains a non-finite number.");
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyJsonValue(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const members: string[] = [];
    for (const key of Object.keys(record)) {
      const item = record[key];
      if (item !== undefined) {
        members.push(`${quoteJsonString(key)}:${stringifyJsonValue(item)}`);
      }
    }
    return `{${members.join(",")}}`;
  }
  invalid(`Message contains a non-JSON value of type ${typeof value}.`);
}

function quoteJsonString(value: string): string {
  const quoted = JSON.stringify(value);
  if (quoted === undefined) {
    invalid("Message contains a string that cannot be serialized.");
  }
  return quoted;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
