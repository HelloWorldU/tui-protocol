import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { spansFromAnsi, type StyledTextSpan } from "@tui-protocol/sdk";
import { renderGateActive, setRenderGate } from "./render-gate.ts";

/**
 * Structural slice of Pi's AssistantMessage that rendering consumes; the bridge
 * passes the real event message through unchanged at runtime.
 */
export interface RenderableAssistantMessage {
  readonly content: readonly {
    readonly type: string;
    readonly text?: string;
    readonly thinking?: string;
  }[];
  readonly stopReason?: string;
  readonly errorMessage?: string;
}

export interface AssistantSpanRenderer {
  /**
   * Renders the message through Pi's real AssistantMessageComponent at the
   * current width and returns the visible text as spans: one span run per
   * rendered line, lines joined by "\n" spans, outer blank spacer lines and
   * the renderer's width padding stripped. The logical text is the rendered
   * projection, so markdown constructs appear in their displayed form and
   * wrapping is baked at the render width (a documented trial limitation).
   */
  render(message: RenderableAssistantMessage, streaming: boolean): readonly StyledTextSpan[];
}

/**
 * Reuses Pi 0.87.1's real assistant renderer instead of copying its styling:
 * one AssistantMessageComponent instance is updated per message event and
 * rendered offscreen, then spansFromAnsi converts the SGR lines. The component
 * is constructed with outputPad 0 so no chrome gutter becomes logical text.
 * Pi's theme builds emphasis through chalk, whose color level follows the
 * process TTY; on the piped stdout of a plain Node process the emphasis
 * attributes vanish (foreground colors are unaffected).
 */
export function createAssistantSpanRenderer(options: { width: () => number }): AssistantSpanRenderer {
  let component: AssistantMessageComponent | undefined;
  return {
    render(message, streaming) {
      ensureTheme();
      component ??= new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 0);
      component.updateContent(message as unknown as AssistantMessage, streaming);
      // The render gate suppresses Pi's transcript UI, which shares this
      // component's prototype; the adapter's own render is not that UI, so the
      // gate lifts for this synchronous call.
      const gated = renderGateActive();
      setRenderGate(false);
      try {
        return normalizeLines(component.render(Math.max(1, options.width())));
      } finally {
        setRenderGate(gated);
      }
    },
  };
}

function ensureTheme(): void {
  try {
    getMarkdownTheme().bold("");
  } catch {
    // No InteractiveMode initialized Pi's theme (focused Node tests); the
    // built-in dark theme is the deterministic fallback.
    initTheme("dark");
  }
}

function normalizeLines(lines: readonly string[]): StyledTextSpan[] {
  const perLine = lines.map(line => trimLineEnd(spansFromAnsi(line)));
  let start = 0;
  let end = perLine.length;
  while (start < end && perLine[start]!.length === 0) start++;
  while (end > start && perLine[end - 1]!.length === 0) end--;
  const spans: StyledTextSpan[] = [];
  for (let index = start; index < end; index++) {
    if (index > start) spans.push({ text: "\n" });
    spans.push(...perLine[index]!);
  }
  return spans;
}

/** Components pad each rendered line to the full width with trailing spaces. */
function trimLineEnd(spans: StyledTextSpan[]): StyledTextSpan[] {
  const trimmed = [...spans];
  for (;;) {
    const last = trimmed.at(-1);
    if (last === undefined) return trimmed;
    const text = last.text.replace(/ +$/, "");
    if (text === last.text) return trimmed;
    if (text === "") {
      trimmed.pop();
      continue;
    }
    trimmed[trimmed.length - 1] = last.style === undefined ? { text } : { text, style: last.style };
    return trimmed;
  }
}
