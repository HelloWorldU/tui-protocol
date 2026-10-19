import type {
  ContentFragment,
  ContentSnapshot,
  LinesTextLine,
  StyledTextSpan,
} from "@tui-protocol/protocol";

// Content-validity rules for text/styled. The wire codec checks span
// structure only; these are the type's content semantics, and violations
// report invalid_content. See docs/rfcs/0002-styled-text-content.md.

const STYLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  "foreground",
  "background",
  "bold",
  "faint",
  "italic",
  "underline",
  "strikethrough",
  "inverse",
]);

const COLOR_ATTRIBUTES: ReadonlySet<string> = new Set([
  "foreground",
  "background",
]);

export function invalidStyledSpanReason(
  spans: readonly StyledTextSpan[],
): string | undefined {
  for (const [index, span] of spans.entries()) {
    if (span.text.length === 0) {
      return `Span ${index} text must not be empty.`;
    }
    const style = span.style;
    if (style === undefined) {
      continue;
    }
    for (const [attribute, value] of Object.entries(style)) {
      if (!STYLE_ATTRIBUTES.has(attribute)) {
        return `Span ${index} uses unknown style attribute ${JSON.stringify(attribute)}.`;
      }
      if (COLOR_ATTRIBUTES.has(attribute)) {
        if (!isValidColor(value)) {
          return `Span ${index} ${attribute} must be "default", a palette index 0-255, or an rgb triple of 0-255.`;
        }
      } else if (typeof value !== "boolean") {
        return `Span ${index} ${attribute} must be a boolean.`;
      }
    }
  }
  return undefined;
}

function isValidColor(value: unknown): boolean {
  if (value === "default") {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1) {
    return false;
  }
  if (keys[0] === "palette") {
    return (
      Number.isSafeInteger(record.palette) &&
      (record.palette as number) >= 0 &&
      (record.palette as number) <= 255
    );
  }
  if (keys[0] === "rgb") {
    const rgb = record.rgb;
    return (
      Array.isArray(rgb) &&
      rgb.length === 3 &&
      rgb.every(
        (component) =>
          Number.isSafeInteger(component) && component >= 0 && component <= 255,
      )
    );
  }
  return false;
}

// Content-validity rules for text/lines (experimental, RFC 0003): each line's
// spans and continuation follow the text/styled rules and contain no line
// break; wrap is "word" or "char"; a fill line is exactly one single-grapheme
// span without other attributes.

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function invalidLinesReason(
  lines: readonly LinesTextLine[],
): string | undefined {
  for (const [index, line] of lines.entries()) {
    for (const [field, spans] of [["spans", line.spans], ["continuation", line.continuation ?? []]] as const) {
      const spanReason = invalidStyledSpanReason(spans);
      if (spanReason !== undefined) {
        return `Line ${index} ${field}: ${spanReason}`;
      }
      if (spans.some((span) => /[\r\n]/.test(span.text))) {
        return `Line ${index} ${field} must not contain a line break.`;
      }
    }
    if (line.wrap !== undefined && line.wrap !== "word" && line.wrap !== "char") {
      return `Line ${index} wrap must be "word" or "char".`;
    }
    if (line.fill !== undefined) {
      if (line.fill !== true) {
        return `Line ${index} fill must be true when present.`;
      }
      if (line.wrap !== undefined || line.continuation !== undefined) {
        return `Fill line ${index} must not declare wrap or continuation.`;
      }
      const span = line.spans[0];
      if (line.spans.length !== 1 || Array.from(graphemes.segment(span!.text)).length !== 1) {
        return `Fill line ${index} must carry exactly one span of one grapheme.`;
      }
    }
  }
  return undefined;
}

/**
 * Rules for joining an Extend fragment or ReplaceSuffix replacement onto the
 * line it continues: that first line must not declare attributes, and a fill
 * line receives no further text.
 */
export function invalidLinesJoinReason(
  continued: LinesTextLine | undefined,
  fragment: readonly LinesTextLine[],
): string | undefined {
  const first = fragment[0];
  if (continued === undefined || first === undefined) {
    return undefined;
  }
  if (first.wrap !== undefined || first.continuation !== undefined || first.fill !== undefined) {
    return "The first fragment line continues an existing line and must not declare attributes.";
  }
  if (continued.fill === true && first.spans.length > 0) {
    return "A fill line cannot be extended.";
  }
  return undefined;
}

export function contentCodeUnits(content: ContentSnapshot): number {
  switch (content.type) {
    case "text/plain":
      return content.data.length;
    case "text/styled":
      return spanTextCodeUnits(content.data);
    case "text/lines":
      // Line separators and continuation prefixes count toward capacity.
      return content.data.reduce(
        (units, line, index) =>
          units + (index > 0 ? 1 : 0) + spanTextCodeUnits(line.spans) +
          spanTextCodeUnits(line.continuation ?? []),
        0,
      );
  }
}

/** The logical text: the projection selection, copy, and search operate on. */
export function contentText(content: ContentSnapshot): string {
  switch (content.type) {
    case "text/plain":
      return content.data;
    case "text/styled":
      return content.data.map((span) => span.text).join("");
    case "text/lines":
      return content.data.map(lineText).join("\n");
  }
}

function lineText(line: LinesTextLine): string {
  return line.spans.map((span) => span.text).join("");
}

function spanTextCodeUnits(spans: readonly StyledTextSpan[]): number {
  let units = 0;
  for (const span of spans) {
    units += span.text.length;
  }
  return units;
}

export function logicalScalarLength(content: ContentSnapshot): number {
  return Array.from(contentText(content)).length;
}

function isLineArray(fragment: readonly unknown[]): fragment is readonly LinesTextLine[] {
  const first = fragment[0];
  return typeof first === "object" && first !== null && "spans" in first;
}

/** Whether an Extend fragment or ReplaceSuffix replacement matches the Block's content type. */
export function fragmentMatchesContent(
  content: ContentSnapshot,
  fragment: ContentFragment,
): boolean {
  if (content.type === "text/plain") {
    return typeof fragment === "string";
  }
  if (typeof fragment === "string") {
    return false;
  }
  // An empty array is a valid empty replacement for either array-shaped type.
  return fragment.length === 0 || isLineArray(fragment) === (content.type === "text/lines");
}

/** Callers must have checked fragmentMatchesContent. */
export function extendedContent(
  content: ContentSnapshot,
  fragment: ContentFragment,
): ContentSnapshot {
  if (content.type === "text/plain" && typeof fragment === "string") {
    return { type: "text/plain", data: `${content.data}${fragment}` };
  }
  if (content.type === "text/styled" && Array.isArray(fragment) && !isLineArray(fragment)) {
    return { type: "text/styled", data: [...content.data, ...(fragment as readonly StyledTextSpan[])] };
  }
  if (content.type === "text/lines" && Array.isArray(fragment)) {
    return { type: "text/lines", data: joinLines(content.data, fragment as readonly LinesTextLine[]) };
  }
  throw new Error("Extend fragment shape does not match the Block content type.");
}

/** Callers must have checked fragmentMatchesContent. */
export function replacedSuffixContent(
  content: ContentSnapshot,
  retain: number,
  replacement: ContentFragment,
): ContentSnapshot {
  if (content.type === "text/plain" && typeof replacement === "string") {
    return {
      type: "text/plain",
      data: `${Array.from(content.data).slice(0, retain).join("")}${replacement}`,
    };
  }
  if (content.type === "text/styled" && Array.isArray(replacement) && !isLineArray(replacement)) {
    return {
      type: "text/styled",
      data: [...spanPrefix(content.data, retain), ...(replacement as readonly StyledTextSpan[])],
    };
  }
  if (content.type === "text/lines" && Array.isArray(replacement)) {
    return {
      type: "text/lines",
      data: joinLines(linesPrefix(content.data, retain), replacement as readonly LinesTextLine[]),
    };
  }
  throw new Error(
    "ReplaceSuffix replacement shape does not match the Block content type.",
  );
}

/** The line a ReplaceSuffix boundary falls in, which its replacement continues. */
export function linesBoundaryLine(
  lines: readonly LinesTextLine[],
  retain: number,
): LinesTextLine | undefined {
  return linesPrefix(lines, retain).at(-1);
}

/**
 * Retained lines at a logical-text scalar boundary, counting LF separators.
 * The boundary line keeps its attributes and is truncated with spanPrefix.
 */
function linesPrefix(lines: readonly LinesTextLine[], retain: number): LinesTextLine[] {
  const kept: LinesTextLine[] = [];
  let position = 0;
  for (const line of lines) {
    const length = Array.from(lineText(line)).length;
    if (retain <= position + length) {
      kept.push({ ...line, spans: spanPrefix(line.spans, retain - position) });
      return kept;
    }
    kept.push(line);
    position += length + 1;
  }
  return kept;
}

/** The fragment's first line continues the last line; further lines are new. */
function joinLines(
  lines: readonly LinesTextLine[],
  fragment: readonly LinesTextLine[],
): LinesTextLine[] {
  const last = lines.at(-1);
  const [first, ...rest] = fragment;
  if (last === undefined || first === undefined) {
    return [...lines, ...fragment];
  }
  return [...lines.slice(0, -1), { ...last, spans: [...last.spans, ...first.spans] }, ...rest];
}

/**
 * The retained prefix of a span list at a logical-text scalar boundary. A
 * boundary inside a span truncates that span and keeps its style.
 */
export function spanPrefix(
  spans: readonly StyledTextSpan[],
  retain: number,
): StyledTextSpan[] {
  const prefix: StyledTextSpan[] = [];
  let remaining = retain;
  for (const span of spans) {
    if (remaining === 0) {
      break;
    }
    const scalars = Array.from(span.text);
    if (scalars.length <= remaining) {
      prefix.push(span);
      remaining -= scalars.length;
    } else {
      const text = scalars.slice(0, remaining).join("");
      prefix.push(span.style === undefined ? { text } : { text, style: span.style });
      remaining = 0;
    }
  }
  return prefix;
}

/**
 * The suffix of a span list after dropping a logical-text scalar prefix; the
 * inverse of spanPrefix. A boundary inside a span truncates that span and
 * keeps its style. Dropping at or beyond the total scalar count leaves an
 * empty list.
 */
export function spanDrop(
  spans: readonly StyledTextSpan[],
  drop: number,
): StyledTextSpan[] {
  const suffix: StyledTextSpan[] = [];
  let remaining = drop;
  for (const span of spans) {
    if (remaining > 0) {
      const scalars = Array.from(span.text);
      if (scalars.length <= remaining) {
        remaining -= scalars.length;
        continue;
      }
      const text = scalars.slice(remaining).join("");
      suffix.push(span.style === undefined ? { text } : { text, style: span.style });
      remaining = 0;
      continue;
    }
    suffix.push(span);
  }
  return suffix;
}
