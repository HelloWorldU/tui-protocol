import type { IDisposable, Terminal } from "@xterm/headless";

import type { BlockHistoryRegion } from "../../xterm-headless/private-core-history.ts";

/**
 * Passive app-region estimate for the experimental region-aware history mode
 * drafted in docs/design/host-region-ownership.md. It exists only because the
 * trial's render gate makes the application's ordinary output exactly its
 * chrome; ungated transcript output would defeat the inference.
 *
 * Tracking rule: the region top is the smallest absolute buffer row the
 * application's cursor has occupied since the last reset, and the bottom is
 * the largest. The mixed ingress feeds the cursor row before and after every
 * ordinary write and the target row of every row-affecting cursor sequence
 * (relative `CSI A`/`B`/`E`/`F`, absolute `CSI d`/`H`/`f`). A full-frame
 * draw (Pi renders its whole frame on start and after resize) establishes
 * the extent exactly; differential redraws move inside it. Plain-text
 * newlines only move the cursor down and are covered by the write-boundary
 * samples.
 *
 * Erase handling: `CSI 2J` blanks viewport rows without moving them, so the
 * extent needs no change (the redraw's samples re-cover the same rows);
 * `CSI 3J` drops scrollback rows, so the extent is translated down by the
 * dropped count and clamped at row 0 (`noteScrollbackClear`). The estimate
 * resets on resize (reflow moves rows by amounts this tracker cannot
 * observe), on `ESC c` (a genuine full reset), and whenever Block placement
 * contradicts it; the application's next frame re-establishes it. While the
 * extent is unknown, Blocks materialize at the cursor as before and the
 * mixed-ingress watchdog remains the conflict detector, so tracking mistakes
 * fail safe instead of corrupting silently. Content-shifting sequences
 * (`CSI S`/`T`/`L`/`M`), reverse index, and application scroll regions are
 * not observed; the placement contradiction check is the backstop for those.
 *
 * This mode is experimental and validated only by the region-ownership tests
 * in this directory.
 */
export class AppRegionTracker implements BlockHistoryRegion, IDisposable {
  readonly #registrations: IDisposable[] = [];
  #top: number | undefined;
  #bottom: number | undefined;

  constructor(terminal: Terminal) {
    this.#registrations.push(terminal.onResize(() => this.reset()));
  }

  topRow(): number | undefined {
    return this.#top;
  }

  bottomRow(): number | undefined {
    return this.#bottom;
  }

  /** Extends the extent to include an observed absolute cursor row. */
  noteCursorRow(row: number): void {
    this.#top = this.#top === undefined ? row : Math.min(this.#top, row);
    this.#bottom = this.#bottom === undefined ? row : Math.max(this.#bottom, row);
  }

  shift(delta: number): void {
    if (this.#top === undefined || this.#bottom === undefined) {
      return;
    }
    this.#top += delta;
    this.#bottom += delta;
    if (this.#top < 0 || this.#bottom < this.#top) {
      this.reset();
    }
  }

  /**
   * Translates the extent down by the rows a `CSI 3J` drops from the top of
   * the buffer, clamping at row 0: surviving viewport rows move up by exactly
   * that count, and a frame the erase genuinely destroyed degrades to the
   * most conservative placement (blocks above everything) until the redraw's
   * samples extend the extent again.
   */
  noteScrollbackClear(droppedRows: number): void {
    if (this.#top === undefined || this.#bottom === undefined) {
      return;
    }
    this.#top = Math.max(0, this.#top - droppedRows);
    this.#bottom = Math.max(0, this.#bottom - droppedRows);
  }

  reset(): void {
    this.#top = undefined;
    this.#bottom = undefined;
  }

  dispose(): void {
    for (const registration of this.#registrations.splice(0)) {
      registration.dispose();
    }
  }
}
