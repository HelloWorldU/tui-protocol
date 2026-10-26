export const supportedTabbyXtermDependency = "^5";

export type XtermCompatibility =
  | { readonly compatible: true }
  | { readonly compatible: false; readonly reason: string };

type UnknownRecord = Record<string, unknown>;

export function readTabbyXtermDependency(
  load: (id: string) => unknown = id => require(id),
): string | undefined {
  try {
    const manifest = load("tabby-terminal/package.json");
    if (!isRecord(manifest) || !isRecord(manifest.devDependencies)) {
      return undefined;
    }
    const dependency = manifest.devDependencies["@xterm/xterm"];
    return typeof dependency === "string" ? dependency : undefined;
  } catch {
    return undefined;
  }
}

export function inspectTabbyXterm(
  terminal: unknown,
  xtermDependency: string | undefined,
): XtermCompatibility {
  if (xtermDependency !== supportedTabbyXtermDependency) {
    return {
      compatible: false,
      reason: `expected Tabby's @xterm/xterm dependency to be ${supportedTabbyXtermDependency}, got ${xtermDependency ?? "unavailable"}`,
    };
  }
  try {
    const candidate = requireRecord(terminal, "terminal");
    requireNumber(candidate, "cols", "terminal.cols", 1);
    requireNumber(candidate, "rows", "terminal.rows", 1);
    for (const method of ["onResize", "onScroll", "write"]) {
      requireFunction(candidate, method, `terminal.${method}`);
    }
    const core = requireRecord(candidate._core, "terminal._core");
    const service = requireRecord(core._bufferService, "terminal._core._bufferService");
    const buffer = requireRecord(service.buffer, "terminal._core._bufferService.buffer");
    for (const field of ["x", "y", "ybase", "ydisp"]) {
      requireNumber(buffer, field, `terminal._core._bufferService.buffer.${field}`);
    }
    for (const method of ["addMarker", "getBlankLine"]) {
      requireFunction(buffer, method, `terminal._core._bufferService.buffer.${method}`);
    }
    const lines = requireRecord(buffer.lines, "terminal._core._bufferService.buffer.lines");
    requireNumber(lines, "length", "terminal._core._bufferService.buffer.lines.length");
    requireNumber(lines, "maxLength", "terminal._core._bufferService.buffer.lines.maxLength", 1);
    for (const method of ["get", "splice"]) {
      requireFunction(lines, method, `terminal._core._bufferService.buffer.lines.${method}`);
    }
    const scroll = requireRecord(service._onScroll, "terminal._core._bufferService._onScroll");
    requireFunction(scroll, "fire", "terminal._core._bufferService._onScroll.fire");
    const getBlankLine = requireFunction(buffer, "getBlankLine", "terminal._core._bufferService.buffer.getBlankLine");
    const blankLine = requireRecord(getBlankLine.call(buffer), "terminal._core._bufferService.buffer.getBlankLine()");
    if (typeof blankLine.isWrapped !== "boolean") {
      throw new Error("expected terminal._core._bufferService.buffer.getBlankLine().isWrapped to be a boolean");
    }
    for (const method of ["copyFrom", "translateToString"]) {
      requireFunction(blankLine, method, `terminal._core._bufferService.buffer.getBlankLine().${method}`);
    }
    return { compatible: true };
  } catch (error) {
    return {
      compatible: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export class TabbyXtermCompatibilityGate {
  readonly #notify: (reason: string) => void;
  #notified = false;

  constructor(notify: (reason: string) => void) {
    this.#notify = notify;
  }

  activate<T>(terminal: unknown, xtermDependency: string | undefined, create: () => T): T | undefined {
    const compatibility = inspectTabbyXterm(terminal, xtermDependency);
    if (!compatibility.compatible) {
      this.#notifyOnce(compatibility.reason);
      return undefined;
    }
    try {
      return create();
    } catch (error) {
      this.#notifyOnce(`receiver initialization failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  #notifyOnce(reason: string): void {
    if (this.#notified) return;
    this.#notified = true;
    this.#notify(reason);
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) throw new Error(`expected ${path} to be an object`);
  return value;
}

function requireFunction(owner: UnknownRecord, field: string, path: string): Function {
  const value = owner[field];
  if (typeof value !== "function") throw new Error(`expected ${path} to be a function`);
  return value;
}

function requireNumber(owner: UnknownRecord, field: string, path: string, minimum = 0): void {
  const value = owner[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`expected ${path} to be an integer greater than or equal to ${minimum}`);
  }
}
