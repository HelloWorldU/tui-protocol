/** Pi's public Terminal interface, captured before PTY. No renderer code is replaced. */
export class CaptureTerminal {
  columns = 60;
  rows = 12;
  readonly kittyProtocolActive = false;
  #write: (data: string) => void;
  #resize?: () => void;
  #input?: (data: string) => void;
  constructor(write: (data: string) => void) { this.#write = write; }
  start(input: (data: string) => void, resize: () => void) { this.#input = input; this.#resize = resize; }
  stop() { this.#input = undefined; this.#resize = undefined; }
  async drainInput() {}
  write(data: string) { this.#write(data); }
  input(data: string) { this.#input?.(data); }
  resize(cols: number) { this.columns = cols; this.#resize?.(); }
  moveBy(lines: number) { if (lines) this.write(`\x1b[${Math.abs(lines)}${lines < 0 ? "A" : "B"}`); }
  hideCursor() { this.write("\x1b[?25l"); }
  showCursor() { this.write("\x1b[?25h"); }
  clearLine() { this.write("\x1b[2K"); }
  clearFromCursor() { this.write("\x1b[J"); }
  clearScreen() { this.write("\x1b[2J\x1b[H"); }
  setTitle(_title: string) {}
  setProgress(_active: boolean) {}
}
