import headless from "@xterm/headless";
import { encodeMessageFrames, ProtocolStreamDecoder, type Message } from "@tui-protocol/protocol";
import type { StyledTextSpan } from "@tui-protocol/sdk";
import { XtermProtocolEndpoint } from "../xterm-protocol-endpoint/index.ts";
import { createAssistantSpanRenderer } from "./styled-renderer.ts";

const { Terminal } = headless;

/** Pi's own rendering of one assistant text message at `width`, as trial spans. */
export function renderAt(markdown: string, width: number): readonly StyledTextSpan[] {
  const renderer = createAssistantSpanRenderer({ width: () => width });
  return renderer.render({ content: [{ type: "text", text: markdown }] }, false);
}

export function logicalLines(spans: readonly StyledTextSpan[]): string[] {
  return spans.map(span => span.text).join("").split("\n");
}

/** One native buffer row; `wrapped` marks a terminal soft-wrap continuation. */
export interface NativeRow {
  readonly text: string;
  readonly wrapped: boolean;
}

/**
 * Native rows after appending `spans` as one styled Block at `appendCols`,
 * then resizing to each later width in turn; trailing blank rows dropped.
 */
export async function terminalRows(
  spans: readonly StyledTextSpan[],
  appendCols: number,
  ...resizeTo: readonly number[]
): Promise<NativeRow[]> {
  const terminal = new Terminal({ allowProposedApi: true, cols: appendCols, rows: 80, scrollback: 200 });
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true,
    optionalContentTypes: ["text/styled"],
  });
  try {
    const decoder = new ProtocolStreamDecoder();
    const send = (message: Message, frameId: number): readonly Message[] =>
      endpoint.push(concat(encodeMessageFrames(message, frameId))).responseFrames
        .flatMap(frame => decoder.push(frame))
        .flatMap(event => (event.type === "message" ? [event.message] : []));
    send({ version: 1, kind: "capability.query", request_id: "c", body: {} }, 1);
    const [opened] = send({ version: 1, kind: "context.open", request_id: "o", body: {} }, 2);
    if (opened?.kind !== "context.open.response" || !("context_id" in opened)) throw new Error("Context did not open.");
    const errors = send({
      version: 1, kind: "block.append", operation_id: "1", context_id: opened.context_id,
      body: { block_id: "answer", lifecycle: "sealed", content: { type: "text/styled", data: spans } },
    }, 3);
    if (errors.length > 0) throw new Error(`Append rejected: ${JSON.stringify(errors)}`);
    await endpoint.drain();
    for (const cols of resizeTo) terminal.resize(cols, 80);
    await endpoint.drain();
    const rows: NativeRow[] = [];
    for (let index = 0; index < terminal.buffer.active.length; index++) {
      const line = terminal.buffer.active.getLine(index);
      rows.push({ text: line?.translateToString(true) ?? "", wrapped: line?.isWrapped ?? false });
    }
    while (rows.length > 0 && rows.at(-1)!.text === "") rows.pop();
    return rows;
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
}

/** Layout differences between terminal-reflowed rows and Pi's own layout at the same width. */
export interface LayoutComparison {
  readonly rows: number;
  readonly piRows: number;
  /** Pi's rows that appear verbatim, in order, among the native rows. */
  readonly matchingRows: number;
  /** Soft wraps that cut a word: letters on both sides of the wrap point. */
  readonly midWordSplits: number;
  /** Soft-wrapped continuations of list or quote lines that lack the line's indent or marker. */
  readonly lostPrefixes: number;
}

export function compareLayout(native: readonly NativeRow[], pi: readonly string[]): LayoutComparison {
  let matchingRows = 0;
  let cursor = 0;
  for (const piRow of pi) {
    const found = native.findIndex((row, index) => index >= cursor && row.text === piRow);
    if (found >= 0) { matchingRows++; cursor = found + 1; }
  }
  let midWordSplits = 0;
  let lostPrefixes = 0;
  let lineStart = "";
  for (const [index, row] of native.entries()) {
    if (!row.wrapped) {
      lineStart = row.text;
      continue;
    }
    const previous = native[index - 1]!.text;
    if (/[A-Za-z]$/.test(previous) && /^[A-Za-z]/.test(row.text)) midWordSplits++;
    const prefix = /^(- |\d+\. |│ )/.exec(lineStart)?.[1];
    if (prefix !== undefined && !row.text.startsWith(prefix.startsWith("│") ? "│ " : " ".repeat(prefix.length))) lostPrefixes++;
  }
  return { rows: native.length, piRows: pi.length, matchingRows, midWordSplits, lostPrefixes };
}

/**
 * Hard line breaks in a render that the wide render does not have: breaks
 * the renderer inserted for width rather than for content structure.
 */
export function bakedBreaks(render: readonly StyledTextSpan[], wide: readonly StyledTextSpan[]): number {
  return logicalLines(render).length - logicalLines(wide).length;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
