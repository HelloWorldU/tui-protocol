/** Bounds owned pending input, not OS/browser buffers or total process memory. */
export class PendingInputBudget {
  #bytes = 0;
  #items = 0;
  readonly #maxBytes: number;
  readonly #maxItems: number;
  constructor(maxBytes: number, maxItems: number) {
    if (![maxBytes, maxItems].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error("Invalid pending input budget");
    this.#maxBytes = maxBytes; this.#maxItems = maxItems;
  }
  acquire(bytes: number): () => void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid input size");
    if (bytes > this.#maxBytes - this.#bytes || this.#items >= this.#maxItems) throw new Error("Pending input budget exhausted");
    this.#bytes += bytes; this.#items++;
    let released = false;
    return () => { if (!released) { released = true; this.#bytes -= bytes; this.#items--; } };
  }
  get usage() { return { bytes: this.#bytes, items: this.#items }; }
}
