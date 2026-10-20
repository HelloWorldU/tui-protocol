import type { StyledTextSpan } from "@tui-protocol/sdk";
import type { LayoutLine } from "../../line-layout/layout.ts";

/**
 * Experimental application-side conversion for RFC 0003: splits Pi's wide
 * (content-breaks-only) render into lines and recovers the layout intent Pi's
 * markdown renderer applies at a known width. In a real integration the
 * renderer would emit these attributes directly; this reads them back from
 * the rendered shapes of the constructs in the wrap sample:
 *
 * - `- ` and `1. ` items, at any nesting indent, continue under their text
 *   (hanging indent);
 * - `│ ` quote lines repeat the marker, with its style;
 * - lines between code fences keep word wrapping without a prefix, as Pi does;
 * - a line made only of `─` is a fill line.
 */
export function linesFromRender(spans: readonly StyledTextSpan[]): LayoutLine[] {
  const lines = splitLines(spans);
  let inCode = false;
  return lines.map(line => {
    const text = line.map(span => span.text).join("");
    if (text.startsWith("```")) {
      inCode = !inCode;
      return { spans: line };
    }
    if (inCode) return { spans: line };
    if (/^─+$/.test(text)) return { spans: [{ ...line[0]!, text: "─" }], fill: true };
    const item = /^( *)(- |\d+\. )/.exec(text);
    if (item !== null) return { spans: line, continuation: [{ text: " ".repeat(item[0].length) }] };
    if (text.startsWith("│ ")) return { spans: line, continuation: prefixSpans(line, 2) };
    return { spans: line };
  });
}

/** Splits spans at line breaks into one span list per line. */
export function splitLines(spans: readonly StyledTextSpan[]): StyledTextSpan[][] {
  const lines: StyledTextSpan[][] = [[]];
  for (const span of spans) {
    const parts = span.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part !== "") lines.at(-1)!.push(span.style === undefined ? { text: part } : { text: part, style: span.style });
    });
  }
  return lines;
}

/** The first `count` characters of a line, keeping their styles. */
function prefixSpans(line: readonly StyledTextSpan[], count: number): StyledTextSpan[] {
  const result: StyledTextSpan[] = [];
  let remaining = count;
  for (const span of line) {
    if (remaining === 0) break;
    const text = [...span.text].slice(0, remaining).join("");
    remaining -= [...text].length;
    result.push(span.style === undefined ? { text } : { text, style: span.style });
  }
  return result;
}
