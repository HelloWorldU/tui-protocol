import type {
  StyledTextColor,
  StyledTextSpan,
  StyledTextStyle,
} from "@tui-protocol/protocol";

/**
 * Parses an ANSI-styled string into `text/styled` spans. Only SGR sequences
 * (`CSI ... m`) are interpreted: reset (0, including empty parameters), the
 * emphasis attributes bold (1), faint (2), italic (3), underline (4),
 * inverse (7), and strikethrough (9) with their individual clears
 * (22, 23, 24, 27, 29), the 16-color foreground (30-37, 90-97) and
 * background (40-47, 100-107) codes mapped to palette indices 0-15,
 * 256-palette colors (38;5;n, 48;5;n), true colors (38;2;r;g;b,
 * 48;2;r;g;b), and default-color restores (39, 49).
 *
 * Limitations of this first version:
 * - Every other escape sequence — non-SGR CSI commands, OSC strings, and
 *   other ESC sequences — is silently discarded, unterminated ones included.
 *   Other control characters (line breaks, tabs) are kept as ordinary text.
 * - Parameters are split on ";" only; colon sub-parameters (for example
 *   underline variants) are not distinguished.
 * - Unknown SGR attributes and out-of-range color parameters are ignored.
 * - Cleared attributes are omitted from the output; the converter never
 *   emits the explicit "default" color.
 *
 * Runs without attributes produce spans without a style field, adjacent runs
 * with equal styles merge into one span, and empty runs never produce a
 * span, so an empty or styling-only input yields an empty span list.
 */
export function spansFromAnsi(text: string): StyledTextSpan[] {
  const spans: { text: string; style?: StyledTextStyle }[] = [];
  let style: MutableStyle = {};
  let run = "";
  let index = 0;

  const emit = () => {
    if (run.length === 0) return;
    const attributes = Object.keys(style).length === 0 ? undefined : style;
    const last = spans.at(-1);
    if (last !== undefined && sameStyle(last.style, attributes)) {
      last.text += run;
    } else if (attributes === undefined) {
      spans.push({ text: run });
    } else {
      spans.push({ text: run, style: attributes });
    }
    run = "";
  };

  while (index < text.length) {
    if (text.charCodeAt(index) !== ESC) {
      run += text[index];
      index += 1;
      continue;
    }
    emit();
    index = skipEscape(text, index, (parameters) => {
      style = applySgr(style, parameters);
    });
  }
  emit();
  return spans;
}

const ESC = 0x1b;

type MutableStyle = { -readonly [K in keyof StyledTextStyle]: StyledTextStyle[K] };

function isParameter(code: number): boolean {
  return code >= 0x30 && code <= 0x3f;
}

function isIntermediate(code: number): boolean {
  return code >= 0x20 && code <= 0x2f;
}

function isCsiFinal(code: number): boolean {
  return code >= 0x40 && code <= 0x7e;
}

/** Returns the index after the escape sequence, interpreting only SGR. */
function skipEscape(
  text: string,
  start: number,
  applySgrParameters: (parameters: string) => void,
): number {
  const introducer = text[start + 1];
  if (introducer === "[") {
    let index = start + 2;
    while (index < text.length && isParameter(text.charCodeAt(index))) index += 1;
    const parameters = text.slice(start + 2, index);
    while (index < text.length && isIntermediate(text.charCodeAt(index))) index += 1;
    if (index < text.length && isCsiFinal(text.charCodeAt(index))) {
      if (text[index] === "m") applySgrParameters(parameters);
      return index + 1;
    }
    return index;
  }
  if (introducer === "]") {
    let index = start + 2;
    while (index < text.length) {
      if (text.charCodeAt(index) === 0x07) return index + 1;
      if (text.charCodeAt(index) === ESC && text[index + 1] === "\\") return index + 2;
      index += 1;
    }
    return index;
  }
  let index = start + 1;
  while (index < text.length && isIntermediate(text.charCodeAt(index))) index += 1;
  if (index < text.length && text.charCodeAt(index) >= 0x30 && text.charCodeAt(index) <= 0x7e) {
    return index + 1;
  }
  return start + 1;
}

function applySgr(style: MutableStyle, parameters: string): MutableStyle {
  const codes = parameters
    .split(";")
    .map((parameter) => (parameter === "" ? 0 : Number.parseInt(parameter, 10)));
  let next: MutableStyle = { ...style };
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index]!;
    if (Number.isNaN(code)) continue;
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.faint = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 9) next.strikethrough = true;
    else if (code === 22) { delete next.bold; delete next.faint; }
    else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 27) delete next.inverse;
    else if (code === 29) delete next.strikethrough;
    else if (code === 39) delete next.foreground;
    else if (code === 49) delete next.background;
    else if (code === 38 || code === 48) {
      const extended = extendedColor(codes, index);
      index += extended.consumed;
      if (extended.color !== undefined) {
        if (code === 38) next.foreground = extended.color;
        else next.background = extended.color;
      }
    } else if (code >= 30 && code <= 37) next.foreground = { palette: code - 30 };
    else if (code >= 40 && code <= 47) next.background = { palette: code - 40 };
    else if (code >= 90 && code <= 97) next.foreground = { palette: code - 90 + 8 };
    else if (code >= 100 && code <= 107) next.background = { palette: code - 100 + 8 };
    // Any other SGR attribute (blink, fonts, ...) is ignored.
  }
  return next;
}

function extendedColor(
  codes: readonly number[],
  index: number,
): { color: StyledTextColor | undefined; consumed: number } {
  const mode = codes[index + 1];
  if (mode === 5) {
    const palette = codes[index + 2];
    if (palette === undefined) return { color: undefined, consumed: 1 };
    const valid = Number.isInteger(palette) && palette >= 0 && palette <= 255;
    return { color: valid ? { palette } : undefined, consumed: 2 };
  }
  if (mode === 2) {
    const components = codes.slice(index + 2, index + 5);
    if (components.length < 3) return { color: undefined, consumed: 1 + components.length };
    const valid = components.every(
      (component) => Number.isInteger(component) && component >= 0 && component <= 255,
    );
    return {
      color: valid ? { rgb: components as unknown as [number, number, number] } : undefined,
      consumed: 4,
    };
  }
  return { color: undefined, consumed: 0 };
}

function sameStyle(a: StyledTextStyle | undefined, b: StyledTextStyle | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameColor(a.foreground, b.foreground) &&
    sameColor(a.background, b.background) &&
    a.bold === b.bold &&
    a.faint === b.faint &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.inverse === b.inverse;
}

function sameColor(a: StyledTextColor | undefined, b: StyledTextColor | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if ("palette" in a) return "palette" in b && a.palette === b.palette;
  return "rgb" in b && a.rgb[0] === b.rgb[0] && a.rgb[1] === b.rgb[1] && a.rgb[2] === b.rgb[2];
}
