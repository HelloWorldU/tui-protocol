import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { Terminal } from "@xterm/xterm";

import type { BlockId, Operation } from "../../block-model/model.ts";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";

export interface ActiveInputSnapshot {
  readonly absoluteRow: number;
  readonly content: string;
  readonly cursorOffset: number;
  readonly focused: boolean;
}

/**
 * Browser-only fixture for one printable ASCII input line after Block history.
 * The prompt and cursor movement are TUI output used to expose xterm state;
 * they are not Block content or proposed protocol Messages.
 */
export class BrowserActiveInputHistory {
  readonly #terminal: Terminal;
  readonly #history: PrivateCoreBlockHistory;
  #prompt: string | undefined;
  #content: string | undefined;

  constructor(terminal: Terminal) {
    this.#terminal = terminal;
    this.#history = new PrivateCoreBlockHistory(
      terminal as unknown as HeadlessTerminal,
    );
  }

  async apply(operation: Operation): Promise<void> {
    await this.#history.apply(operation);
    this.#terminal.refresh(0, this.#terminal.rows - 1);
  }

  async setActiveInput(
    prompt: string,
    content: string,
    cursorOffset: number,
  ): Promise<void> {
    if (this.#prompt !== undefined) {
      throw new Error("This fixture supports only one active input line.");
    }
    if (!/^[\x20-\x7e]*$/.test(prompt) || !/^[\x20-\x7e]*$/.test(content)) {
      throw new Error("Active input content is limited to printable ASCII.");
    }
    if (cursorOffset < 0 || cursorOffset > content.length) {
      throw new Error("The input cursor offset is outside the input content.");
    }
    if (prompt.length + content.length >= this.#terminal.cols) {
      throw new Error("The active input must fit on one physical row.");
    }

    await write(this.#terminal, `${prompt}${content}`);
    const moveLeft = content.length - cursorOffset;
    if (moveLeft > 0) {
      await write(this.#terminal, `\u001b[${moveLeft}D`);
    }
    this.#prompt = prompt;
    this.#content = content;
    this.#terminal.refresh(0, this.#terminal.rows - 1);
  }

  focus(): void {
    this.#terminal.focus();
  }

  snapshot(): ActiveInputSnapshot {
    const prompt = this.#prompt;
    const content = this.#content;
    if (prompt === undefined || content === undefined) {
      throw new Error("The active input fixture has not been written.");
    }
    const buffer = this.#terminal.buffer.active;
    const absoluteRow = buffer.baseY + buffer.cursorY;
    const rendered = buffer.getLine(absoluteRow)?.translateToString(true);
    if (rendered === undefined) {
      throw new Error(`Active input row ${absoluteRow} is missing.`);
    }
    return {
      absoluteRow,
      content: rendered,
      cursorOffset: buffer.cursorX - prompt.length,
      focused: document.activeElement === this.#terminal.textarea,
    };
  }

  resize(cols: number, rows: number): void {
    const prompt = this.#prompt;
    const content = this.#content;
    if (
      prompt !== undefined &&
      content !== undefined &&
      prompt.length + content.length >= cols
    ) {
      throw new Error("The tested input must remain on one physical row.");
    }
    this.#terminal.resize(cols, rows);
    this.#terminal.refresh(0, this.#terminal.rows - 1);
  }

  range(id: BlockId):
    | Readonly<{ start: number; lineCount: number }>
    | undefined {
    return this.#history.range(id);
  }

  textarea(): HTMLTextAreaElement {
    const textarea = this.#terminal.textarea;
    if (textarea === undefined) {
      throw new Error("xterm did not create its input textarea.");
    }
    return textarea;
  }

  compositionView(): HTMLElement {
    const view = this.#terminal.element?.querySelector<HTMLElement>(
      ".composition-view",
    );
    if (view === null || view === undefined) {
      throw new Error("xterm did not create its composition view.");
    }
    return view;
  }

  dispose(): void {
    this.#history.dispose();
  }
}

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}
