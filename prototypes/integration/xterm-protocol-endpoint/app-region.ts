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
 * The estimate resets on resize (reflow moves rows by amounts this tracker
 * cannot observe), on `CSI 2J` / `CSI 3J` / `ESC c`, and whenever Block
 * placement contradicts it; the application's next frame re-establishes it.
 * While the extent is unknown, Blocks materialize at the cursor as before
 * and the mixed-ingress watchdog remains the conflict detector, so tracking
 * mistakes fail safe instead of corrupting silently. Content-shifting
 * sequences (`CSI S`/`T`/`L`/`M`), reverse index, and application scroll
 * regions are not observed; the placement contradiction check is the
 * backstop for those.
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
