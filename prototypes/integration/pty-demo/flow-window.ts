/** Local test-host byte accounting, not a terminal protocol message or limit. */
export class FlowWindow {
  sent = 0;
  consumed = 0;
  peak = 0;
  paused = false;
  pauses = 0;
  resumes = 0;
  readonly high: number;
  readonly low: number;
  constructor(high: number, low: number) {
    if (!Number.isSafeInteger(high) || !Number.isSafeInteger(low) || low < 0 || high <= low) {
      throw new Error("Invalid flow watermarks");
    }
    this.high = high; this.low = low;
  }
  get outstanding() { return this.sent - this.consumed; }
  add(size: number): boolean {
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(this.sent + size)) throw new Error("Invalid byte count");
    this.sent += size;
    this.peak = Math.max(this.peak, this.outstanding);
    if (!this.paused && this.outstanding >= this.high) {
      this.paused = true; this.pauses++; return true;
    }
    return false;
  }
  acknowledge(total: number): boolean {
    if (!Number.isSafeInteger(total) || total < this.consumed || total > this.sent) throw new Error("Invalid consumed offset");
    this.consumed = total;
    if (this.paused && this.outstanding <= this.low) {
      this.paused = false; this.resumes++; return true;
    }
    return false;
  }
}
