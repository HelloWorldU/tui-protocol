import type { Readable, Writable } from "node:stream";
import { StdinBuffer, type Terminal } from "@earendil-works/pi-tui";
import type { TuiClient } from "@tui-protocol/sdk";

export type TrialInput = Readable & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (raw: boolean) => unknown };
export type TrialOutput = Writable & { isTTY?: boolean; columns?: number; rows?: number };

export interface TrialTerminalOptions {
  readonly input: TrialInput;
  readonly output: TrialOutput;
  readonly client: TuiClient;
  readonly onProtocolFailure: (error: Error) => void;
  readonly escapeTimeoutMs?: number;
}

const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;
const RIGHT_BRACKET = 0x5d;
// Complete reply frames are small; this cap only bounds a peer that never terminates one.
const MAX_REPLY_BUFFER_BYTES = 65_536;

function resolveEscapeTimeoutMs(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.PI_TUI_ESC_TIMEOUT);
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (env.SSH_CONNECTION || env.SSH_TTY) return 100;
  return 10;
}

type SplitState = "ground" | "esc" | "oscClassify" | "oscProtocol" | "oscProtocolEsc" | "oscOrdinary" | "oscOrdinaryEsc";

/**
 * Trial-owned pi-tui Terminal: chrome bytes pass through to the output stream,
 * the SDK client writes OSC 9002 frames to the same stream, and input is split
 * by routing complete OSC 9002 reply frames to TuiClient.receive while every
 * other byte reaches Pi's onInput verbatim and in order. A lone ESC is released
 * after the same escape timeout ProcessTerminal applies, so Pi's interrupt key
 * keeps working. Kitty keyboard negotiation is not performed;
 * kittyProtocolActive stays false (trial limitation).
 */
export class TrialTerminal implements Terminal {
  readonly #input: TrialInput;
  readonly #output: TrialOutput;
  readonly #client: TuiClient;
  readonly #onProtocolFailure: (error: Error) => void;
  readonly #escapeTimeoutMs: number;
  readonly #decoder = new TextDecoder("utf-8");
  #attached = false;
  #started = false;
  #stopped = false;
  #draining = false;
  #wasRaw = false;
  #onInput?: (data: string) => void;
  #onResize?: () => void;
  #stdinBuffer?: StdinBuffer;
  #preStart: string[] = [];
  #splitState: SplitState = "ground";
  #oscBuffer: number[] = [];
  #escapeTimer?: ReturnType<typeof setTimeout>;
  #progressInterval?: ReturnType<typeof setInterval>;

  constructor(options: TrialTerminalOptions) {
    this.#input = options.input;
    this.#output = options.output;
    this.#client = options.client;
    this.#onProtocolFailure = options.onProtocolFailure;
    this.#escapeTimeoutMs = options.escapeTimeoutMs ?? resolveEscapeTimeoutMs(process.env);
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  get columns(): number {
    return this.#output.columns || Number(process.env.COLUMNS) || 80;
  }

  get rows(): number {
    return this.#output.rows || Number(process.env.LINES) || 24;
  }

  /** Owns stdin before negotiation so the capability reply can arrive. */
  attach(): void {
    if (this.#attached) throw new Error("Trial terminal is already attached");
    this.#attached = true;
    this.#wasRaw = this.#input.isRaw ?? false;
    this.#input.setRawMode?.(true);
    this.#input.on("data", this.#onStdinData);
    this.#input.resume();
  }

  /** Restores the pre-attach stream state so ProcessTerminal can take over untouched. */
  detach(): void {
    if (!this.#attached) return;
    this.#attached = false;
    this.#clearEscapeTimer();
    this.#input.off("data", this.#onStdinData);
    this.#input.pause();
    if (this.#input.setRawMode) this.#input.setRawMode(this.#wasRaw);
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    if (this.#started) throw new Error("Trial terminal is already started");
    if (!this.#attached) this.attach();
    this.#onInput = onInput;
    this.#onResize = onResize;
    this.#output.on("resize", onResize);
    this.#stdinBuffer = new StdinBuffer({ escapeTimeout: this.#escapeTimeoutMs });
    this.#stdinBuffer.on("data", sequence => {
      if (this.#onInput && !this.#draining) this.#onInput(sequence);
    });
    this.#stdinBuffer.on("paste", content => {
      if (this.#onInput && !this.#draining) this.#onInput(`\x1b[200~${content}\x1b[201~`);
    });
    this.#output.write("\x1b[?2004h");
    this.#started = true;
    const queued = this.#preStart.splice(0);
    for (const text of queued) this.#stdinBuffer.process(text);
  }

  stop(): void {
    if (this.#progressInterval) {
      clearInterval(this.#progressInterval);
      this.#progressInterval = undefined;
      this.#output.write("\x1b]9;4;0\x07");
    }
    this.#output.write("\x1b[?2004l");
    this.#stopped = true;
    this.#onInput = undefined;
    if (this.#onResize) {
      this.#output.off("resize", this.#onResize);
      this.#onResize = undefined;
    }
    this.#stdinBuffer?.destroy();
    this.#stdinBuffer = undefined;
    this.#preStart = [];
    this.detach();
  }

  async drainInput(maxMs = 1000, idleMs = 50): Promise<void> {
    this.#draining = true;
    let lastDataAt = Date.now();
    const onData = () => { lastDataAt = Date.now(); };
    this.#input.on("data", onData);
    const endAt = Date.now() + maxMs;
    try {
      for (;;) {
        const now = Date.now();
        const remaining = endAt - now;
        if (remaining <= 0 || now - lastDataAt >= idleMs) break;
        await new Promise(resolve => setTimeout(resolve, Math.min(idleMs, remaining)));
      }
    } finally {
      this.#input.off("data", onData);
      this.#draining = false;
    }
  }

  write(data: string): void {
    this.#output.write(data);
  }

  moveBy(lines: number): void {
    if (lines > 0) this.#output.write(`\x1b[${lines}B`);
    else if (lines < 0) this.#output.write(`\x1b[${-lines}A`);
  }

  hideCursor(): void {
    this.#output.write("\x1b[?25l");
  }

  showCursor(): void {
    this.#output.write("\x1b[?25h");
  }

  clearLine(): void {
    this.#output.write("\x1b[K");
  }

  clearFromCursor(): void {
    this.#output.write("\x1b[J");
  }

  clearScreen(): void {
    this.#output.write("\x1b[2J\x1b[H");
  }

  setTitle(title: string): void {
    this.#output.write(`\x1b]0;${title}\x07`);
  }

  setProgress(active: boolean): void {
    if (active) {
      this.#output.write("\x1b]9;4;3\x07");
      this.#progressInterval ??= setInterval(() => this.#output.write("\x1b]9;4;3\x07"), 1000);
    } else {
      if (this.#progressInterval) {
        clearInterval(this.#progressInterval);
        this.#progressInterval = undefined;
      }
      this.#output.write("\x1b]9;4;0\x07");
    }
  }

  readonly #onStdinData = (chunk: Buffer | string): void => {
    if (this.#stopped) return;
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    for (const byte of bytes) this.#split(byte);
  };

  #split(byte: number): void {
    switch (this.#splitState) {
      case "ground":
        if (byte === ESC) {
          this.#splitState = "esc";
          this.#armEscapeTimer();
        } else {
          this.#emitOrdinary(byte);
        }
        return;
      case "esc":
        this.#clearEscapeTimer();
        if (byte === RIGHT_BRACKET) {
          this.#oscBuffer = [ESC, RIGHT_BRACKET];
          this.#splitState = "oscClassify";
        } else if (byte === ESC) {
          this.#emitOrdinary(ESC);
          this.#armEscapeTimer();
        } else {
          this.#emitOrdinary(ESC, byte);
          this.#splitState = "ground";
        }
        return;
      case "oscClassify": {
        this.#oscBuffer.push(byte);
        // Bytes after the ESC ] prefix.
        const content = this.#oscBuffer.slice(2);
        const prefix = "9002;";
        let matches = true;
        for (let index = 0; index < content.length; index++) {
          if (content[index] !== prefix.charCodeAt(index)) {
            matches = false;
            break;
          }
        }
        if (matches && content.length === prefix.length) {
          this.#splitState = "oscProtocol";
        } else if (!matches) {
          for (const held of this.#oscBuffer) this.#emitOrdinary(held);
          this.#oscBuffer = [];
          this.#splitState = "oscOrdinary";
        }
        return;
      }
      case "oscProtocol":
        this.#oscBuffer.push(byte);
        if (byte === BEL) this.#flushProtocol("ground");
        else if (byte === ESC) this.#splitState = "oscProtocolEsc";
        else if (this.#oscBuffer.length > MAX_REPLY_BUFFER_BYTES) this.#flushProtocol("ground");
        return;
      case "oscProtocolEsc":
        this.#oscBuffer.push(byte);
        if (byte === BACKSLASH || byte === BEL) this.#flushProtocol("ground");
        else if (byte === ESC) return;
        else this.#flushProtocol("ground");
        return;
      case "oscOrdinary":
        this.#emitOrdinary(byte);
        if (byte === BEL) this.#splitState = "ground";
        else if (byte === ESC) this.#splitState = "oscOrdinaryEsc";
        return;
      case "oscOrdinaryEsc":
        this.#emitOrdinary(byte);
        if (byte === BACKSLASH || byte === BEL) this.#splitState = "ground";
        else if (byte === ESC) return;
        else this.#splitState = "oscOrdinary";
        return;
    }
  }

  /** A complete OSC 9002 reply frame goes to the client; the codec validates it. */
  #flushProtocol(next: SplitState): void {
    const frame = Uint8Array.from(this.#oscBuffer);
    this.#oscBuffer = [];
    this.#splitState = next;
    let events: ReturnType<TuiClient["receive"]>;
    try {
      events = this.#client.receive(frame);
    } catch (error) {
      this.#fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    for (const event of events) {
      if (event.type === "message" && event.message.kind === "protocol.error") {
        this.#fail(new Error(`Terminal rejected Operation: ${event.message.body.code}`));
        return;
      }
      if (event.type === "error") {
        this.#fail(new Error(`Protocol input failed: ${event.reason}`));
        return;
      }
      if (event.type === "ordinary") {
        this.#fail(new Error("Protocol decoder emitted ordinary bytes inside a reply frame"));
        return;
      }
    }
  }

  #emitOrdinary(...bytes: number[]): void {
    const text = this.#decoder.decode(Uint8Array.from(bytes), { stream: true });
    if (text === "") return;
    if (this.#started && this.#stdinBuffer) this.#stdinBuffer.process(text);
    else if (!this.#stopped) this.#preStart.push(text);
  }

  #armEscapeTimer(): void {
    this.#escapeTimer = setTimeout(() => {
      this.#escapeTimer = undefined;
      if (this.#splitState !== "esc") return;
      this.#splitState = "ground";
      this.#emitOrdinary(ESC);
    }, this.#escapeTimeoutMs);
    this.#escapeTimer.unref?.();
  }

  #clearEscapeTimer(): void {
    if (this.#escapeTimer) clearTimeout(this.#escapeTimer);
    this.#escapeTimer = undefined;
  }

  #fail(error: Error): void {
    this.#onProtocolFailure(error);
  }
}
