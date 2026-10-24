import type { LinesTextLine } from "@tui-protocol/sdk";
import { linesFromRender } from "./lines-from-render.ts";
import { createAssistantSpanRenderer, type RenderableAssistantMessage } from "./styled-renderer.ts";

/** Wide enough that Pi inserts no width breaks into the trial's prose. */
export const WIDE_RENDER_COLUMNS = 1000;

export interface AssistantLinesRenderer {
  /**
   * Renders the message through Pi's real AssistantMessageComponent once,
   * without width breaks, and returns text/lines lines whose layout
   * attributes (hanging indents, quote markers, rules) the experimental
   * reader recovers from the rendered shapes. The terminal lays the lines out
   * at every width, so nothing is baked at a render width.
   */
  render(message: RenderableAssistantMessage, streaming: boolean): LinesTextLine[];
}

export function createAssistantLinesRenderer(): AssistantLinesRenderer {
  const spans = createAssistantSpanRenderer({ width: () => WIDE_RENDER_COLUMNS });
  return {
    render(message, streaming) {
      return linesFromRender(spans.render(message, streaming));
    },
  };
}
