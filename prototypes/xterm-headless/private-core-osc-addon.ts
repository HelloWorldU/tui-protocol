import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/headless";

import { PrivateCoreBlockHistory } from "./private-core-history.ts";
import {
  EXPERIMENTAL_BLOCK_OSC,
  parseExperimentalOperation,
} from "./osc-adapter.ts";

export interface ExperimentalPrivateCoreOscAddonOptions {
  readonly onError: (error: Error, payload: string) => void;
}

/** Connects the experimental OSC transport to the private-core history spike. */
export class ExperimentalPrivateCoreOscAddon implements ITerminalAddon {
  readonly #history: PrivateCoreBlockHistory;
  readonly #onError: (error: Error, payload: string) => void;
  #registration: IDisposable | undefined;
  #pending: Promise<void> = Promise.resolve();

  constructor(
    history: PrivateCoreBlockHistory,
    options: ExperimentalPrivateCoreOscAddonOptions,
  ) {
    this.#history = history;
    this.#onError = options.onError;
  }

  activate(terminal: Terminal): void {
    if (this.#registration !== undefined) {
      throw new Error("ExperimentalPrivateCoreOscAddon is already active.");
    }

    this.#registration = terminal.parser.registerOscHandler(
      EXPERIMENTAL_BLOCK_OSC,
      (payload) => {
        let operation;
        try {
          operation = parseExperimentalOperation(payload);
        } catch (error: unknown) {
          this.#onError(toError(error), payload);
          return true;
        }

        // Defer execution until the current xterm parser write completes.
        // Append itself writes materialized content through the same terminal.
        this.#pending = this.#pending
          .then(() => this.#history.apply(operation))
          .catch((error: unknown) => {
            this.#onError(toError(error), payload);
          });
        return true;
      },
    );
  }

  async drain(): Promise<void> {
    await this.#pending;
  }

  dispose(): void {
    this.#registration?.dispose();
    this.#registration = undefined;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
