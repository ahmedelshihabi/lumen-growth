import type { CreativeDailyMetric, ISODate } from '../data/types';
import { aggregate, rangeEnding, filterRange, safeDiv } from '../lib/metrics';
import { addDays } from '../lib/dates';
import type { AccountTarget } from './types';

/**
 * poor        - delivers far worse than the account goal (CPA >= 2x target, or spend with no result).
 *               Separate from fatigue: a bad ad can be fresh, a fatigued ad can still be profitable.
 * fatigued    - frequency rising while engagement or efficiency falls (CTR, hook rate or CPA).
 * watch       - the same signals, weaker.
 * healthy     - none of the above.
 * insufficient- too few impressions in either window to judge.
 */
export type FatigueStatus = 'poor' | 'fatigued' | 'watch' | 'healthy' | 'insufficient';

export interface FatigueResult {
  status: FatigueStatus;
  recentCtr: number;
  priorCtr: number;
  recentFrequency: number;
  priorFrequency: number;
  /** relative change, e.g. 0.2 = +20% */
  frequencyChange: number;
  ctrChange: number;
  recentCpa: number;
  priorCpa: number;
  /** relative CPA change; 0 when either window has no conversions */
  cpaChange: number;
  /** 3-second views / impressions; null for non-video creatives */
  recentHook: number | null;
  priorHook: number | null;
  hookChange: number | null;
}

export interface FatigueConfig {
  windowDays: number;
  minImpressions: number;
  fatiguedFreqRise: number;
  fatiguedCtrDrop: number;
  fatiguedHookDrop: number;
  fatiguedCpaRise: number;
  watchFreqRise: number;
  watchCtrDrop: number;
  watchHookDrop: number;
  watchCpaRise: number;
  /** "poor": recent CPA at least this multiple of the target CPA (needs >= poorMinConversions). */
  poorCpaMultiple: number;
  poorMinConversions: number;
  /** "poor": spend of at least this many target CPAs with zero conversions. */
  poorNoConversionSpendMultiple: number;
}

export const DEFAULT_FATIGUE_CONFIG: FatigueConfig = {
  windowDays: 7,
  minImpressions: 2000,
  fatiguedFreqRise: 0.15,
  fatiguedCtrDrop: 0.15,
  fatiguedHookDrop: 0.15,
  fatiguedCpaRise: 0.25,
  // The old watch band (8% / 8%) almost never fired because the fatigued band swallowed it.
  watchFreqRise: 0.05,
  watchCtrDrop: 0.05,
  watchHookDrop: 0.05,
  watchCpaRise: 0.1,
  poorCpaMultiple: 2,
  poorMinConversions: 3,
  poorNoConversionSpendMultiple: 2,
};

function weightedFrequency(rows: readonly CreativeDailyMetric[]): number {
  let w = 0;
  let s = 0;
  for (const r of rows) {
    w += r.impressions;
    s += r.frequency * r.impressions;
  }
  return safeDiv(s, w);
}

const rel = (now: number, before: number) => (before ? now / before - 1 : 0);

/**
 * Compare the last `windowDays` to the window before it. `rows` must belong to one creative.
 * Pass the account `target` to also detect "poor" performers.
 */
export function detectFatigue(
  rows: readonly CreativeDailyMetric[],
  asOf: ISODate,
  config: FatigueConfig = DEFAULT_FATIGUE_CONFIG,
  target?: AccountTarget,
): FatigueResult {
  const recentRange = rangeEnding(asOf, config.windowDays);
  const priorRange = rangeEnding(addDays(asOf, -config.windowDays), config.windowDays);
  const recentRows = filterRange(rows, recentRange);
  const priorRows = filterRange(rows, priorRange);
  const recent = aggregate(recentRows);
  const prior = aggregate(priorRows);
  const recentFrequency = weightedFrequency(recentRows);
  const priorFrequency = weightedFrequency(priorRows);
  const frequencyChange = rel(recentFrequency, priorFrequency);
  const ctrChange = rel(recent.ctr, prior.ctr);
  const cpaChange = recent.conversions > 0 && prior.conversions > 0 ? rel(recent.cpa, prior.cpa) : 0;

  const views = (rs: readonly CreativeDailyMetric[]) => rs.reduce((s, r) => s + r.videoViews3s, 0);
  const isVideo = views(recentRows) + views(priorRows) > 0;
  const recentHook = isVideo ? safeDiv(views(recentRows), recent.impressions) : null;
  const priorHook = isVideo ? safeDiv(views(priorRows), prior.impressions) : null;
  const hookChange = recentHook !== null && priorHook ? rel(recentHook, priorHook) : null;

  let status: FatigueStatus = 'healthy';
  const enough = recent.impressions >= config.minImpressions && prior.impressions >= config.minImpressions;
  const poor =
    !!target &&
    target.targetCpa > 0 &&
    recent.impressions >= config.minImpressions &&
    ((recent.conversions >= config.poorMinConversions && recent.cpa >= target.targetCpa * config.poorCpaMultiple) ||
      (recent.conversions === 0 && recent.spend >= target.targetCpa * config.poorNoConversionSpendMultiple));
  const declining = (ctr: number, hook: number, cpa: number) =>
    ctrChange <= -ctr || (hookChange !== null && hookChange <= -hook) || cpaChange >= cpa;

  if (poor) status = 'poor';
  else if (!enough) status = 'insufficient';
  else if (frequencyChange >= config.fatiguedFreqRise && declining(config.fatiguedCtrDrop, config.fatiguedHookDrop, config.fatiguedCpaRise))
    status = 'fatigued';
  else if (frequencyChange >= config.watchFreqRise && declining(config.watchCtrDrop, config.watchHookDrop, config.watchCpaRise))
    status = 'watch';

  return {
    status,
    recentCtr: recent.ctr,
    priorCtr: prior.ctr,
    recentFrequency,
    priorFrequency,
    frequencyChange,
    ctrChange,
    recentCpa: recent.cpa,
    priorCpa: prior.cpa,
    cpaChange,
    recentHook,
    priorHook,
    hookChange,
  };
}
