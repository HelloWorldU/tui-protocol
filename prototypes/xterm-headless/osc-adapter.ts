import type {
  IDisposable,
  ITerminalAddon,
  Terminal,
} from "@xterm/headless";

import {
  type BlockLifecycle,
  type Operation,
  type TerminalPrototype,
} from "../block-model/model.ts";

/** Temporary identifier for this parser spike. It is not a protocol choice. */
export const EXPERIMENTAL_BLOCK_OSC = 777;

export interface ExperimentalBlockOscAddonOptions {
  readonly onError: (error: Error, payload: string) => void;
}

export class ExperimentalBlockOscAddon implements ITerminalAddon {
  readonly #model: TerminalPrototype;
  readonly #onError: (error: Error, payload: string) => void;
  readonly #registrations: IDisposable[] = [];

  constructor(
    model: TerminalPrototype,
    options: ExperimentalBlockOscAddonOptions,
  ) {
    this.#model = model;
    this.#onError = options.onError;
  }

  activate(terminal: Terminal): void {
    if (this.#registrations.length > 0) {
      throw new Error("ExperimentalBlockOscAddon is already active.");
    }

    this.#model.resize({ width: terminal.cols, height: terminal.rows });
    this.#registrations.push(
      terminal.parser.registerOscHandler(EXPERIMENTAL_BLOCK_OSC, (payload) => {
        try {
          this.#model.apply(parseExperimentalOperation(payload));
        } catch (error: unknown) {
          this.#onError(toError(error), payload);
        }
        return true;
      }),
      terminal.onResize(({ cols, rows }) => {
        this.#model.resize({ width: cols, height: rows });
      }),
    );
  }

  dispose(): void {
    for (const registration of this.#registrations.splice(0)) {
      registration.dispose();
    }
  }
}

export function encodeExperimentalOperation(operation: Operation): string {
  return `\u001B]${EXPERIMENTAL_BLOCK_OSC};${JSON.stringify(operation)}\u001B\\`;
}

export function parseExperimentalOperation(payload: string): Operation {
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch (error: unknown) {
    throw new ExperimentalOperationError(
      `Operation payload is not valid JSON: ${toError(error).message}`,
    );
  }

  const operation = requireRecord(decoded, "Operation");
  const type = requireString(operation, "type", "Operation");

  switch (type) {
    case "append": {
      const block = requireRecord(operation.block, "Append.block");
      return {
        type,
        block: {
          id: requireString(block, "id", "Append.block"),
          content: requireString(block, "content", "Append.block"),
          lifecycle: requireLifecycle(block.lifecycle),
        },
      };
    }
    case "update":
      return {
        type,
        id: requireString(operation, "id", "Update"),
        content: requireString(operation, "content", "Update"),
      };
    case "seal":
      return {
        type,
        id: requireString(operation, "id", "Seal"),
      };
    default:
      throw new ExperimentalOperationError(
        `Unsupported Operation type ${JSON.stringify(type)}.`,
      );
  }
}

export class ExperimentalOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentalOperationError";
  }
}

function requireRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ExperimentalOperationError(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(
  record: Record<string, unknown>,
  field: string,
  context: string,
): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new ExperimentalOperationError(
      `${context}.${field} must be a string.`,
    );
  }
  return value;
}

function requireLifecycle(value: unknown): BlockLifecycle {
  if (value !== "mutable" && value !== "sealed") {
    throw new ExperimentalOperationError(
      "Append.block.lifecycle must be mutable or sealed.",
    );
  }
  return value;
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
