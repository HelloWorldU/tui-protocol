import type {
  StyledTextColor,
  StyledTextSpan,
  StyledTextStyle,
} from "@tui-protocol/protocol";

import { fixtureCellWidth } from "./plain-text.ts";

const SGR_RESET = "\x1b[0m";

/**
 * Translates span styles to SGR sequences around the span texts: each style
 * change resets first, then sets the new style, and a trailing reset keeps
 * styling from leaking into later terminal writes. Spans without a style use
 * the terminal default, so unstyled span lists produce exactly their text.
 */
export function spansToSgr(spans: readonly StyledTextSpan[]): string {
  let result = "";
  let active = "";
  for (const span of spans) {
    const parameters = styleParameters(span.style);
    if (parameters !== active) {
      if (active !== "") {
        result += SGR_RESET;
      }
      if (parameters !== "") {
        result += `\x1b[${parameters}m`;
      }
      active = parameters;
    }
    result += span.text;
  }
  if (active !== "") {
    result += SGR_RESET;
  }
  return result;
}

/**
 * Applies the shared plain-text projection (newline normalization, control
 * labels, logical-line Tab stops) to styled spans without crossing style
 * boundaries: every scalar's displayed form, including control labels and Tab
 * spaces, keeps its span's style. Mirrors projectPlainText so styled and
 * plain content lay out identically; a CRLF pair split across spans still
 * normalizes to one newline.
 */
export function projectStyledSpans(
  spans: readonly StyledTextSpan[],
  tabWidth = 8,
): StyledTextSpan[] {
  const pieces: { text: string; style?: StyledTextStyle }[] = [];
  const emit = (text: string, style: StyledTextStyle | undefined): void => {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.style === style) {
      last.text += text;
    } else {
      pieces.push(style === undefined ? { text } : { text, style });
    }
  };

  const scalars = spans.flatMap((span) =>
    Array.from(span.text, (char) => ({ char, style: span.style })),
  );
  let column = 0;
  for (let index = 0; index < scalars.length; index += 1) {
    const { char, style } = scalars[index];
    const code = char.codePointAt(0)!;
    if (char === "\r") {
      // A CRLF pair displays one break; attribute it to the LF's span.
      const lineFeed = scalars[index + 1]?.char === "\n" ? scalars[index + 1] : undefined;
      emit("\n", lineFeed === undefined ? style : lineFeed.style);
      if (lineFeed !== undefined) {
        index += 1;
      }
      column = 0;
    } else if (char === "\n") {
      emit("\n", style);
      column = 0;
    } else if (char === "\t") {
      const spaces = tabWidth - (column % tabWidth);
      emit(" ".repeat(spaces), style);
      column += spaces;
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      const label = `<U+${code.toString(16).toUpperCase().padStart(4, "0")}>`;
      emit(label, style);
      column += label.length;
    } else {
      emit(char, style);
      column += fixtureCellWidth(char) ?? char.length;
    }
  }
  return pieces;
}

function styleParameters(style: StyledTextStyle | undefined): string {
  if (style === undefined) {
    return "";
  }
  const parameters: string[] = [];
  if (style.foreground !== undefined) {
    parameters.push(...colorParameters(style.foreground, false));
  }
  if (style.background !== undefined) {
    parameters.push(...colorParameters(style.background, true));
  }
  if (style.bold === true) {
    parameters.push("1");
  }
  if (style.faint === true) {
    parameters.push("2");
  }
  if (style.italic === true) {
    parameters.push("3");
  }
  if (style.underline === true) {
    parameters.push("4");
  }
  if (style.inverse === true) {
    parameters.push("7");
  }
  if (style.strikethrough === true) {
    parameters.push("9");
  }
  return parameters.join(";");
}

function colorParameters(
  color: StyledTextColor,
  background: boolean,
): string[] {
  if (color === "default") {
    return [background ? "49" : "39"];
  }
  if ("palette" in color) {
    return [background ? "48" : "38", "5", String(color.palette)];
  }
  return [
    background ? "48" : "38",
    "2",
    String(color.rgb[0]),
    String(color.rgb[1]),
    String(color.rgb[2]),
  ];
}
