/** Local bridge policy: time out only while sent bytes have no consumption progress. */
export class ConsumptionWatchdog {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private consumed = 0;
  private stopped = false;
  private readonly timeoutMs: number;
  private readonly onStall: () => void;

  constructor(timeoutMs: number, onStall: () => void) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      throw new Error("Invalid consumption timeout");
    }
    this.timeoutMs = timeoutMs;
    this.onStall = onStall;
  }

  // Call after FlowWindow validates accounting. Sending more data or repeating
  // an offset is not consumption progress and must not postpone the deadline.
  update(outstanding: number, consumed: number) {
    if (this.stopped) return;
    const progressed = consumed > this.consumed;
    this.consumed = consumed;
    if (outstanding === 0 || progressed) {
      clearTimeout(this.timer); this.timer = undefined;
    }
    if (outstanding > 0 && this.timer === undefined) {
      this.timer = setTimeout(() => {
        this.dispose(); this.onStall();
      }, this.timeoutMs);
    }
  }

  dispose() {
    this.stopped = true;
    clearTimeout(this.timer); this.timer = undefined;
  }
}
