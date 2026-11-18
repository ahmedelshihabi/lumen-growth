import type { AccountTarget } from './types';
import { DEFAULT_EVAL_CONFIG, healthFromRatio, lacksValueTracking, performanceRatio, type Health } from './evaluate';
import { safeDiv } from '../lib/metrics';

export type { Health } from './evaluate';
export { lacksValueTracking } from './evaluate';

export interface HealthInput {
  spend: number;
  roas: number;
  cpa: number;
  conversions: number;
  revenue?: number;
  conversations?: number;
}

/**
 * Health of a SALES campaign against its account goals (thin wrapper over evaluate.ts,
 * kept for callers that only have totals). For anything objective-aware use the
 * `health` field of summarizeCampaigns(), which is the source of truth.
 */
export function campaignHealth(m: HealthInput, target: AccountTarget): Health {
  const revenue = m.revenue ?? m.roas * m.spend;
  const t = {
    spend: m.spend,
    revenue,
    impressions: 0,
    clicks: 0,
    conversions: m.conversions,
    roas: m.roas,
    cpa: m.cpa || safeDiv(m.spend, m.conversions),
    ctr: 0,
    cpm: 0,
    conversations: m.conversations ?? 0,
    costPerConversation: 0,
  };
  const kind = lacksValueTracking({ ...t, revenue: m.revenue }) ? 'leads' : 'sales';
  return healthFromRatio(performanceRatio(kind, t, target, null, DEFAULT_EVAL_CONFIG), m.spend, false);
}

/** Colour a single metric vs its goal. `higherIsBetter` for ROAS/CTR, false for CPA. */
export function metricHealth(value: number, goal: number, higherIsBetter: boolean): Exclude<Health, 'inactive' | 'unrated'> {
  if (!goal || !value) return higherIsBetter ? 'critical' : 'good';
  const ratio = higherIsBetter ? value / goal : goal / value;
  if (ratio >= 1) return 'good';
  if (ratio >= 0.8) return 'warning';
  return 'critical';
}
