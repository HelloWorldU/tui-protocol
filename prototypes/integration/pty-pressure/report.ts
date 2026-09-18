export interface ProducerReport {
  updates: number;
  drainWaits: number;
  longestWrite: { index: number; durationMs: number; startedAt: number; endedAt: number };
}

/** The fixture prints one final JSON record, possibly soft-wrapped by xterm. */
export function readProducerReport(rows: readonly string[], expectedUpdates: number): ProducerReport {
  const parts = rows.join("").split("PRODUCER:");
  if (parts.length !== 2) throw new Error("Expected one producer timing report");
  const value = JSON.parse(parts[1]!);
  const write = value?.longestWrite;
  if (value?.updates !== expectedUpdates || !Number.isSafeInteger(value.drainWaits) || value.drainWaits < 0 ||
      !write || !Number.isSafeInteger(write.index) || write.index < 0 || write.index > expectedUpdates ||
      !Number.isFinite(write.durationMs) || write.durationMs < 0 ||
      !Number.isSafeInteger(write.startedAt) || write.startedAt < 0 ||
      !Number.isSafeInteger(write.endedAt) || write.endedAt < write.startedAt) {
    throw new Error("Invalid producer timing report");
  }
  return value;
}

export function intervalOverlap(start: number, end: number, otherStart: number, otherEnd: number): number {
  if (![start, end, otherStart, otherEnd].every(Number.isFinite) || end < start || otherEnd < otherStart) {
    throw new Error("Invalid timing interval");
  }
  return Math.max(0, Math.min(end, otherEnd) - Math.max(start, otherStart));
}
