export interface StreamingOrdinaryWriterOptions {
  readonly write: (text: string) => Promise<void>;
  readonly settle: () => Promise<void>;
}

export class StreamingOrdinaryWriter {
  readonly #decoder = new TextDecoder();
  readonly #writeText: (text: string) => Promise<void>;
  readonly #settle: () => Promise<void>;

  constructor(options: StreamingOrdinaryWriterOptions) {
    this.#writeText = options.write;
    this.#settle = options.settle;
  }

  async write(data: Uint8Array): Promise<void> {
    await this.#write(this.#decoder.decode(data, { stream: true }));
  }

  async finish(): Promise<void> {
    await this.#write(this.#decoder.decode());
  }

  async #write(text: string): Promise<void> {
    if (text.length > 0) await this.#writeText(text);
    await this.#settle();
  }
}
