export class StrictJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrictJsonError";
  }
}

export function parseStrictJson(source: string): unknown {
  return new JsonParser(source).parse();
}

class JsonParser {
  readonly #source: string;
  #index = 0;

  constructor(source: string) {
    this.#source = source;
  }

  parse(): unknown {
    this.#skipWhitespace();
    const value = this.#parseValue();
    this.#skipWhitespace();
    if (this.#index !== this.#source.length) {
      this.#fail("Unexpected bytes after the JSON value");
    }
    return value;
  }

  #parseValue(): unknown {
    const character = this.#source[this.#index];
    switch (character) {
      case "{":
        return this.#parseObject();
      case "[":
        return this.#parseArray();
      case '"':
        return this.#parseString();
      case "t":
        return this.#parseLiteral("true", true);
      case "f":
        return this.#parseLiteral("false", false);
      case "n":
        return this.#parseLiteral("null", null);
      default:
        if (character === "-" || isDigit(character)) {
          return this.#parseNumber();
        }
        this.#fail("Expected a JSON value");
    }
  }

  #parseObject(): Record<string, unknown> {
    this.#index += 1;
    this.#skipWhitespace();
    const entries: Array<[string, unknown]> = [];
    const names = new Set<string>();

    if (this.#consume("}")) {
      return {};
    }

    while (true) {
      if (this.#source[this.#index] !== '"') {
        this.#fail("Expected an object member name");
      }
      const name = this.#parseString();
      if (names.has(name)) {
        this.#fail(`Duplicate object member ${JSON.stringify(name)}`);
      }
      names.add(name);

      this.#skipWhitespace();
      this.#expect(":");
      this.#skipWhitespace();
      entries.push([name, this.#parseValue()]);
      this.#skipWhitespace();

      if (this.#consume("}")) {
        return Object.fromEntries(entries);
      }
      this.#expect(",");
      this.#skipWhitespace();
    }
  }

  #parseArray(): unknown[] {
    this.#index += 1;
    this.#skipWhitespace();
    const values: unknown[] = [];

    if (this.#consume("]")) {
      return values;
    }

    while (true) {
      values.push(this.#parseValue());
      this.#skipWhitespace();
      if (this.#consume("]")) {
        return values;
      }
      this.#expect(",");
      this.#skipWhitespace();
    }
  }

  #parseString(): string {
    this.#expect('"');
    let result = "";

    while (this.#index < this.#source.length) {
      const code = this.#source.charCodeAt(this.#index);
      if (code === 0x22) {
        this.#index += 1;
        return result;
      }
      if (code === 0x5c) {
        this.#index += 1;
        result += this.#parseEscape();
        continue;
      }
      if (code < 0x20) {
        this.#fail("Unescaped control character in string");
      }
      if (isHighSurrogate(code)) {
        const low = this.#source.charCodeAt(this.#index + 1);
        if (!isLowSurrogate(low)) {
          this.#fail("Unpaired high surrogate in string");
        }
        result += this.#source[this.#index] + this.#source[this.#index + 1];
        this.#index += 2;
        continue;
      }
      if (isLowSurrogate(code)) {
        this.#fail("Unpaired low surrogate in string");
      }
      result += this.#source[this.#index];
      this.#index += 1;
    }

    this.#fail("Unterminated string");
  }

  #parseEscape(): string {
    const escaped = this.#source[this.#index];
    this.#index += 1;
    switch (escaped) {
      case '"':
      case "\\":
      case "/":
        return escaped;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u": {
        const first = this.#parseHexCodeUnit();
        if (isHighSurrogate(first)) {
          if (this.#source.slice(this.#index, this.#index + 2) !== "\\u") {
            this.#fail("Unpaired high surrogate escape");
          }
          this.#index += 2;
          const second = this.#parseHexCodeUnit();
          if (!isLowSurrogate(second)) {
            this.#fail("Invalid low surrogate escape");
          }
          return String.fromCodePoint(
            0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00),
          );
        }
        if (isLowSurrogate(first)) {
          this.#fail("Unpaired low surrogate escape");
        }
        return String.fromCharCode(first);
      }
      default:
        this.#fail("Invalid string escape");
    }
  }

  #parseHexCodeUnit(): number {
    const text = this.#source.slice(this.#index, this.#index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(text)) {
      this.#fail("Invalid Unicode escape");
    }
    this.#index += 4;
    return Number.parseInt(text, 16);
  }

  #parseNumber(): number {
    const rest = this.#source.slice(this.#index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      rest,
    );
    if (match === null) {
      this.#fail("Invalid JSON number");
    }
    this.#index += match[0].length;
    return Number(match[0]);
  }

  #parseLiteral<T>(text: string, value: T): T {
    if (this.#source.slice(this.#index, this.#index + text.length) !== text) {
      this.#fail(`Expected ${text}`);
    }
    this.#index += text.length;
    return value;
  }

  #skipWhitespace(): void {
    while (
      this.#source[this.#index] === " " ||
      this.#source[this.#index] === "\t" ||
      this.#source[this.#index] === "\n" ||
      this.#source[this.#index] === "\r"
    ) {
      this.#index += 1;
    }
  }

  #consume(character: string): boolean {
    if (this.#source[this.#index] !== character) {
      return false;
    }
    this.#index += 1;
    return true;
  }

  #expect(character: string): void {
    if (!this.#consume(character)) {
      this.#fail(`Expected ${JSON.stringify(character)}`);
    }
  }

  #fail(message: string): never {
    throw new StrictJsonError(`${message} at offset ${this.#index}.`);
  }
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
