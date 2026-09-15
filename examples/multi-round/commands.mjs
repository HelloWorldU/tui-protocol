// Application commands, not protocol messages. Busy-time input is not queued.
export class Commands {
  #waiting;
  #controller = new AbortController();
  get signal() { return this.#controller.signal; }
  next() {
    if (this.signal.aborted) return Promise.resolve(false);
    if (this.#waiting) throw new Error("Already waiting for a command");
    return new Promise(resolve => { this.#waiting = resolve; });
  }
  feed(bytes) {
    if (bytes.includes(113) || bytes.includes(3)) { this.stop(); return; }
    if (bytes.includes(110) && this.#waiting) {
      const resolve = this.#waiting;
      this.#waiting = undefined;
      resolve(true);
    }
  }
  stop() {
    this.#controller.abort();
    this.#waiting?.(false);
    this.#waiting = undefined;
  }
}
