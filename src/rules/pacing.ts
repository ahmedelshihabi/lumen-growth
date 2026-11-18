import type { Campaign, CampaignDailyMetric, ISODate } from '../data/types';
import { addDays, daysInMonth, startOfMonth } from '../lib/dates';
import { safeDiv } from '../lib/metrics';

export type PacingStatus = 'over' | 'under' | 'on_track' | 'paused';

export interface PacingResult {
  campaignId: string;
  monthlyBudget: number;
  mtdSpend: number;
  /** Linear plan: budget * elapsed / daysInMonth */
  expectedToDate: number;
  /** Average daily spend over the last `runRateDays` days (zero-spend days count). */
  runRate: number;
  projected: number;
  /** projected / monthlyBudget */
  pacing: number;
  status: PacingStatus;
  daysElapsed: number;
  daysRemaining: number;
  /** Daily spend needed for the rest of the month to land exactly on budget. */
  recommendedDaily: number;
}

export interface PacingConfig {
  overThreshold: number;
  underThreshold: number;
  runRateDays: number;
}

export const DEFAULT_PACING_CONFIG: PacingConfig = { overThreshold: 1.1, underThreshold: 0.9, runRateDays: 7 };

/**
 * Month-to-date pacing for one campaign. `asOf` is the last complete day; the
 * month is the month containing `asOf`. Projection = MTD + run-rate x remaining days.
 */
export function computePacing(
  campaign: Campaign,
  rows: readonly CampaignDailyMetric[],
  asOf: ISODate,
  config: PacingConfig = DEFAULT_PACING_CONFIG,
): PacingResult {
  const monthStart = startOfMonth(asOf);
  const dim = daysInMonth(asOf);
  const daysElapsed = Number(asOf.slice(8, 10));
  const daysRemaining = dim - daysElapsed;

  const own = rows.filter((r) => r.campaignId === campaign.id);
  const mtdSpend = own.filter((r) => r.date >= monthStart && r.date <= asOf).reduce((s, r) => s + r.spend, 0);
  const rrStart = addDays(asOf, -(config.runRateDays - 1));
  const rrSpend = own.filter((r) => r.date >= rrStart && r.date <= asOf).reduce((s, r) => s + r.spend, 0);
  const runRate = campaign.status === 'PAUSED' ? 0 : rrSpend / config.runRateDays;

  const projected = mtdSpend + runRate * daysRemaining;
  const budget = campaign.monthlyBudget;
  const pacing = safeDiv(projected, budget);
  const expectedToDate = (budget * daysElapsed) / dim;

  let status: PacingStatus;
  if (campaign.status === 'PAUSED') status = 'paused';
  else if (pacing >= config.overThreshold) status = 'over';
  else if (pacing <= config.underThreshold) status = 'under';
  else status = 'on_track';

  return {
    campaignId: campaign.id,
    monthlyBudget: budget,
    mtdSpend,
    expectedToDate,
    runRate,
    projected,
    pacing,
    status,
    daysElapsed,
    daysRemaining,
    recommendedDaily: daysRemaining > 0 ? Math.max(0, (budget - mtdSpend) / daysRemaining) : 0,
  };
}

/**
 * What to do about pacing, given how the campaign performs (verdict from evaluate.ts).
 * Pacing alone would say "cut" to every over-pacer; a campaign beating its goal should get
 * more plan, not less. The Pacing page and the recommendations both use this.
 */
export type PacingAdvice = 'raise_plan' | 'reduce' | 'increase' | 'hold' | 'none';

export function pacingAdvice(p: PacingResult, verdict: import('./evaluate').Verdict | null): PacingAdvice {
  if (p.status === 'paused' || p.monthlyBudget <= 0 || p.daysRemaining <= 0) return 'none';
  if (p.status === 'over') return verdict === 'scale' ? 'raise_plan' : verdict === null ? 'hold' : 'reduce';
  if (p.status === 'under') return verdict === 'scale' ? 'increase' : 'hold';
  return 'none';
}
