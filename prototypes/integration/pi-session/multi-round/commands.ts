export type Command = { type: "prompt"; text: string } | { type: "cancel" } | { type: "quit" };
export const MAX_PROMPT_UNITS = 2000;

/** Trial-local form input over stdin, not a protocol Message or a general terminal editor. */
export class CommandReader {
  #pending: number[] = [];
  push(bytes: Uint8Array, accept: (command: Command) => void): void {
    for (const byte of bytes) {
      if (byte !== 10) {
        if (this.#pending.length >= 12_100) throw new Error("Input command exceeds trial limit");
        this.#pending.push(byte);
        continue;
      }
      const line = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(this.#pending));
      this.#pending = [];
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid application command");
      const command = value as Record<string, unknown>;
      if (command.type === "prompt" && Object.keys(command).length === 2 && typeof command.text === "string" &&
          command.text.trim() && command.text.length <= MAX_PROMPT_UNITS && !/[\uD800-\uDFFF]/u.test(command.text)) {
        accept({ type: "prompt", text: command.text });
      } else if ((command.type === "cancel" || command.type === "quit") && Object.keys(command).length === 1) {
        accept({ type: command.type });
      } else throw new Error("Invalid application command");
    }
  }
}
