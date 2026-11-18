import type { AccountTarget } from './types';

export type Health = 'good' | 'warning' | 'critical' | 'inactive';

export interface HealthInput {
  spend: number;
  roas: number;
  cpa: number;
  conversions: number;
  revenue?: number;
  conversations?: number;
}

/**
 * True when a campaign gets results but reports no purchase value: click-to-WhatsApp /
 * Messenger campaigns, or a pixel that fires Purchase without a value. ROAS is meaningless
 * for these (it reads 0), so they are judged by CPA / cost per conversation instead and are
 * never told to pause or give up budget because of ROAS.
 */
export function lacksValueTracking(m: HealthInput): boolean {
  return m.spend > 0 && m.revenue !== undefined && m.revenue <= 0 && (m.conversions > 0 || (m.conversations ?? 0) > 0);
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
  if (lacksValueTracking(m)) {
    // No purchase value: judge by CPA alone; conversation-only campaigns have no goal to compare to.
    if (m.conversions <= 0 || target.targetCpa <= 0) return 'warning';
    const c = target.targetCpa / m.cpa;
    return c >= 1 ? 'good' : c >= 0.8 ? 'warning' : 'critical';
  }
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
