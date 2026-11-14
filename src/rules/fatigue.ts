import type { CreativeDailyMetric, ISODate } from '../data/types';
import { aggregate, rangeEnding, filterRange, safeDiv } from '../lib/metrics';
import { addDays } from '../lib/dates';

export type FatigueStatus = 'fatigued' | 'watch' | 'healthy' | 'insufficient';

export interface FatigueResult {
  status: FatigueStatus;
  recentCtr: number;
  priorCtr: number;
  recentFrequency: number;
  priorFrequency: number;
  /** relative change, e.g. 0.2 = +20% */
  frequencyChange: number;
  ctrChange: number;
}

export interface FatigueConfig {
  windowDays: number;
  minImpressions: number;
  fatiguedFreqRise: number;
  fatiguedCtrDrop: number;
  watchFreqRise: number;
  watchCtrDrop: number;
}

export const DEFAULT_FATIGUE_CONFIG: FatigueConfig = {
  windowDays: 7,
  minImpressions: 2000,
  fatiguedFreqRise: 0.15,
  fatiguedCtrDrop: 0.15,
  watchFreqRise: 0.08,
  watchCtrDrop: 0.08,
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

/**
 * Creative fatigue = frequency rising while CTR falls, comparing the last
 * `windowDays` to the window before it. `rows` must belong to one creative.
 */
export function detectFatigue(
  rows: readonly CreativeDailyMetric[],
  asOf: ISODate,
  config: FatigueConfig = DEFAULT_FATIGUE_CONFIG,
): FatigueResult {
  const recentRange = rangeEnding(asOf, config.windowDays);
  const priorRange = rangeEnding(addDays(asOf, -config.windowDays), config.windowDays);
  const recentRows = filterRange(rows, recentRange);
  const priorRows = filterRange(rows, priorRange);
  const recent = aggregate(recentRows);
  const prior = aggregate(priorRows);
  const recentFrequency = weightedFrequency(recentRows);
  const priorFrequency = weightedFrequency(priorRows);
  const frequencyChange = priorFrequency ? recentFrequency / priorFrequency - 1 : 0;
  const ctrChange = prior.ctr ? recent.ctr / prior.ctr - 1 : 0;

  let status: FatigueStatus = 'healthy';
  if (recent.impressions < config.minImpressions || prior.impressions < config.minImpressions) {
    status = 'insufficient';
  } else if (frequencyChange >= config.fatiguedFreqRise && ctrChange <= -config.fatiguedCtrDrop) {
    status = 'fatigued';
  } else if (frequencyChange >= config.watchFreqRise && ctrChange <= -config.watchCtrDrop) {
    status = 'watch';
  }

  return {
    status,
    recentCtr: recent.ctr,
    priorCtr: prior.ctr,
    recentFrequency,
    priorFrequency,
    frequencyChange,
    ctrChange,
  };
}
