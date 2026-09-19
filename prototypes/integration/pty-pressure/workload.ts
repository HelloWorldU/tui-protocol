// Fixed experiment fixtures, not application options or protocol limits.
export const workloads = {
  small: { updates: 256, padding: 2048, holdMs: 0 },
  composed: { updates: 128, padding: 32768, holdMs: 2000 },
  stalled: { updates: 128, padding: 32768, holdMs: null },
} as const;
export type Workload = (typeof workloads)[keyof typeof workloads];
