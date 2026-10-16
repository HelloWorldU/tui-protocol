import type {
  ContentSnapshot,
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

export function contentCodeUnits(content: ContentSnapshot): number {
  return content.type === "text/plain"
    ? content.data.length
    : spanTextCodeUnits(content.data);
}

/** The logical text: the projection selection, copy, and search operate on. */
export function contentText(content: ContentSnapshot): string {
  return content.type === "text/plain"
    ? content.data
    : content.data.map((span) => span.text).join("");
}

function spanTextCodeUnits(spans: readonly StyledTextSpan[]): number {
  let units = 0;
  for (const span of spans) {
    units += span.text.length;
  }
  return units;
}

export function logicalScalarLength(content: ContentSnapshot): number {
  if (content.type === "text/plain") {
    return Array.from(content.data).length;
  }
  let scalars = 0;
  for (const span of content.data) {
    scalars += Array.from(span.text).length;
  }
  return scalars;
}

/** Whether an Extend fragment or ReplaceSuffix replacement matches the Block's content type. */
export function fragmentMatchesContent(
  content: ContentSnapshot,
  fragment: unknown,
): boolean {
  return content.type === "text/plain"
    ? typeof fragment === "string"
    : Array.isArray(fragment);
}

/** Callers must have checked fragmentMatchesContent. */
export function extendedContent(
  content: ContentSnapshot,
  fragment: string | readonly StyledTextSpan[],
): ContentSnapshot {
  if (content.type === "text/plain" && typeof fragment === "string") {
    return { type: "text/plain", data: `${content.data}${fragment}` };
  }
  if (content.type === "text/styled" && Array.isArray(fragment)) {
    return { type: "text/styled", data: [...content.data, ...fragment] };
  }
  throw new Error("Extend fragment shape does not match the Block content type.");
}

/** Callers must have checked fragmentMatchesContent. */
export function replacedSuffixContent(
  content: ContentSnapshot,
  retain: number,
  replacement: string | readonly StyledTextSpan[],
): ContentSnapshot {
  if (content.type === "text/plain" && typeof replacement === "string") {
    return {
      type: "text/plain",
      data: `${Array.from(content.data).slice(0, retain).join("")}${replacement}`,
    };
  }
  if (content.type === "text/styled" && Array.isArray(replacement)) {
    return {
      type: "text/styled",
      data: [...spanPrefix(content.data, retain), ...replacement],
    };
  }
  throw new Error(
    "ReplaceSuffix replacement shape does not match the Block content type.",
  );
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
