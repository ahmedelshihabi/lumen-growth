import type { AccountTarget } from './types';

export type Health = 'good' | 'warning' | 'critical' | 'inactive';

export interface HealthInput {
  spend: number;
  roas: number;
  cpa: number;
  conversions: number;
}

/**
 * Score a campaign against its account goals. The score is the worse of
 * ROAS-vs-target and CPA-vs-target (1.0 = exactly on goal).
 * >= 1.0 good, >= 0.8 warning (within 20%), otherwise critical.
 */
export function healthScore(m: HealthInput, target: AccountTarget): number {
  if (m.spend <= 0) return NaN;
  const roasScore = target.targetRoas > 0 ? m.roas / target.targetRoas : 1;
  const cpaScore = m.conversions > 0 && target.targetCpa > 0 ? target.targetCpa / m.cpa : 0;
  return Math.min(roasScore, cpaScore);
}

export function campaignHealth(m: HealthInput, target: AccountTarget): Health {
  if (m.spend <= 0) return 'inactive';
  const s = healthScore(m, target);
  if (s >= 1) return 'good';
  if (s >= 0.8) return 'warning';
  return 'critical';
}

/** Colour a single metric vs its goal. `higherIsBetter` for ROAS/CTR, false for CPA. */
export function metricHealth(value: number, goal: number, higherIsBetter: boolean): Exclude<Health, 'inactive'> {
  if (!goal || !value) return higherIsBetter ? 'critical' : 'good';
  const ratio = higherIsBetter ? value / goal : goal / value;
  if (ratio >= 1) return 'good';
  if (ratio >= 0.8) return 'warning';
  return 'critical';
}
