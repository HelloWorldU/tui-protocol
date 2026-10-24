import type { LinesTextLine, StyledTextSpan } from "@tui-protocol/sdk";
import { spanDrop, spanPrefix } from "@tui-protocol/terminal";

/** The Operation that turns the sent lines into the next lines (RFC 0003 rules). */
export type LinesEdit =
  | { readonly kind: "none" }
  | { readonly kind: "extend"; readonly fragment: readonly LinesTextLine[] }
  | { readonly kind: "replaceSuffix"; readonly retain: number; readonly replacement: readonly LinesTextLine[] }
  | { readonly kind: "update" };

/**
 * Chooses the smallest edit the protocol allows. A fragment or replacement's
 * first line continues an existing line and may not change its attributes,
 * so a line whose attributes changed is replaced from the end of the line
 * before it; only a change to the first line's attributes needs an Update.
 */
export function linesEdit(previous: readonly LinesTextLine[], next: readonly LinesTextLine[]): LinesEdit {
  let index = 0;
  while (index < previous.length && index < next.length && lineEqual(previous[index]!, next[index]!)) index++;
  if (index === previous.length && index === next.length) return { kind: "none" };
  if (index === previous.length) {
    // Every sent line is unchanged: new lines follow an empty continuation.
    return { kind: "extend", fragment: [{ spans: [] }, ...next.slice(index)] };
  }
  const base = lineBase(previous, index);
  const sent = previous[index]!;
  const following = next[index];
  if (following !== undefined && sameAttributes(sent, following)) {
    const sentScalars = scalars(sent.spans);
    if (index === previous.length - 1 && spansEqual(spanPrefix(following.spans, sentScalars), sent.spans)) {
      return { kind: "extend", fragment: [{ spans: spanDrop(following.spans, sentScalars) }, ...next.slice(index + 1)] };
    }
    let shared = 0;
    while (shared < sent.spans.length && shared < following.spans.length && spanEqual(sent.spans[shared]!, following.spans[shared]!)) shared++;
    const kept = scalars(sent.spans.slice(0, shared));
    return {
      kind: "replaceSuffix",
      retain: base + kept,
      replacement: [{ spans: spanDrop(following.spans, kept) }, ...next.slice(index + 1)],
    };
  }
  if (index === 0) return { kind: "update" };
  // Retain through the end of the previous line, dropping its separator.
  return {
    kind: "replaceSuffix",
    retain: base - 1,
    replacement: following === undefined ? [] : [{ spans: [] }, ...next.slice(index)],
  };
}

/** Logical scalar offset where line `index` starts: earlier lines plus their LF separators. */
function lineBase(lines: readonly LinesTextLine[], index: number): number {
  let base = 0;
  for (const line of lines.slice(0, index)) base += scalars(line.spans) + 1;
  return base;
}

function scalars(spans: readonly StyledTextSpan[]): number {
  return spans.reduce((total, span) => total + Array.from(span.text).length, 0);
}

function lineEqual(a: LinesTextLine, b: LinesTextLine): boolean {
  return sameAttributes(a, b) && spansEqual(a.spans, b.spans);
}

function sameAttributes(a: LinesTextLine, b: LinesTextLine): boolean {
  return a.wrap === b.wrap && a.fill === b.fill && JSON.stringify(a.continuation ?? null) === JSON.stringify(b.continuation ?? null);
}

function spansEqual(a: readonly StyledTextSpan[], b: readonly StyledTextSpan[]): boolean {
  return a.length === b.length && a.every((span, index) => spanEqual(span, b[index]!));
}

function spanEqual(a: StyledTextSpan, b: StyledTextSpan): boolean {
  return a.text === b.text && JSON.stringify(a.style ?? null) === JSON.stringify(b.style ?? null);
}
