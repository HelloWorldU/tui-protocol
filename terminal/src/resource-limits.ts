/** Local implementation budgets, not negotiated protocol limits. Strings count UTF-16 code units. */
export interface SessionResourceLimits {
  maxBlockCodeUnits: number;
  maxTotalContentCodeUnits: number;
  maxBlocks: number;
  maxContexts: number;
  maxOperationIds: number;
  maxControlResults: number;
  maxControlFingerprintCodeUnits: number;
  maxIdentifierCodeUnits: number;
}

/** Bounded trial profile; not a production sizing recommendation. */
export const trialSessionLimits: Readonly<SessionResourceLimits> = Object.freeze({
  maxBlockCodeUnits: 262_144, maxTotalContentCodeUnits: 1_048_576,
  maxBlocks: 1024, maxContexts: 16, maxOperationIds: 16_384,
  maxControlResults: 1024, maxControlFingerprintCodeUnits: 262_144,
  maxIdentifierCodeUnits: 256,
});

export function validateSessionLimits(limits: SessionResourceLimits): SessionResourceLimits {
  for (const name of Object.keys(trialSessionLimits) as (keyof SessionResourceLimits)[]) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] <= 0) throw new Error(`Invalid resource limit: ${name}`);
  }
  return { ...limits };
}
