/**
 * Single source of truth for judging a campaign. Health colours, alerts, recommendations,
 * pacing advice and creatives all go through these functions, so two pages can never
 * disagree about the same campaign.
 *
 *  - The metric depends on the campaign's objective: sales -> ROAS & CPA, leads/messages ->
 *    cost per result, traffic -> CPC, awareness -> CPM. Awareness is never judged on ROAS.
 *  - One ladder turns "performance vs goal" into a decision (pause / cut / watch / scale).
 *  - Frequency caps depend on the audience (prospecting vs retargeting).
 *  - Nothing is recommended without enough data, and every judgement carries a confidence.
 */
import type { Campaign, CampaignDailyMetric, DateRange } from '../data/types';
import type { Totals } from '../lib/metrics';
import type { AccountTarget } from './types';

export type CampaignKind = 'sales' | 'leads' | 'traffic' | 'awareness';
export type AudienceType = 'prospecting' | 'retargeting';
/** good = on/above goal, warning = within the watch band, critical = below it, unrated = no goal to compare with. */
export type Health = 'good' | 'warning' | 'critical' | 'inactive' | 'unrated';
export type Verdict = 'scale' | 'watch' | 'cut' | 'pause';
export type Confidence = 'low' | 'medium' | 'high';

export interface EvalConfig {
  /** Performance ratio (1 = exactly on goal) below which a campaign should be paused. */
  pauseBelow: number;
  /** ...below which its budget should be cut (between pauseBelow and this). */
  cutBelow: number;
  /** ...at/above which it can be scaled. Between cutBelow and this: watch. */
  scaleFrom: number;
  freqCapProspecting: number;
  freqCapRetargeting: number;
  /** Minimum delivery before any recommendation. */
  minActiveDays: number;
  minConversions: number;
  /** Thresholds for "high" confidence. */
  highConfidenceDays: number;
  highConfidenceConversions: number;
  /** Peers needed to benchmark CPM / CPC / cost per result when there is no explicit goal. */
  minPeers: number;
}

export const DEFAULT_EVAL_CONFIG: EvalConfig = {
  pauseBelow: 0.5,
  cutBelow: 0.8,
  scaleFrom: 1.0,
  freqCapProspecting: 3.5,
  freqCapRetargeting: 7,
  minActiveDays: 7,
  minConversions: 10,
  highConfidenceDays: 14,
  highConfidenceConversions: 30,
  minPeers: 2,
};

/** Results reported without any purchase value: click-to-WhatsApp, lead forms, or a pixel firing Purchase without value. */
export function lacksValueTracking(t: Pick<Totals, 'spend' | 'conversions'> & { revenue?: number; conversations?: number }): boolean {
  return t.spend > 0 && t.revenue !== undefined && t.revenue <= 0 && (t.conversions > 0 || (t.conversations ?? 0) > 0);
}

export function campaignKind(c: Pick<Campaign, 'objective'>, t?: Totals): CampaignKind {
  if (c.objective === 'AWARENESS') return 'awareness';
  if (c.objective === 'TRAFFIC') return 'traffic';
  if (c.objective === 'LEADS') return 'leads';
  // A "sales" campaign that only produces conversations / value-less results behaves like a leads campaign.
  if (t && lacksValueTracking(t)) return 'leads';
  return 'sales';
}

const RETARGETING_RE = /retarget|remarket|\brtg\b|\bdpa\b|viewers|visitors|add[ -]?to[ -]?cart|\batc\b|abandon|engagers|ريتارجت|إعادة استهداف/i;

/** Retargeting audiences tolerate far higher frequency. Detected from the campaign name (or an explicit tag). */
export function audienceType(c: Pick<Campaign, 'name'> & { audience?: AudienceType }): AudienceType {
  if (c.audience) return c.audience;
  return RETARGETING_RE.test(c.name) ? 'retargeting' : 'prospecting';
}

export function frequencyCap(c: Pick<Campaign, 'name'> & { audience?: AudienceType }, cfg: EvalConfig = DEFAULT_EVAL_CONFIG): number {
  return audienceType(c) === 'retargeting' ? cfg.freqCapRetargeting : cfg.freqCapProspecting;
}

/** Cost of one result for leads/messages campaigns: purchases if any, else conversations. */
export function costPerResult(t: Totals): number {
  const results = t.conversions > 0 ? t.conversions : t.conversations;
  return results > 0 ? t.spend / results : 0;
}

/** The metric used for peer benchmarking, lower is better. 0 = no data. */
function costMetric(kind: CampaignKind, t: Totals): number {
  if (kind === 'awareness') return t.cpm;
  if (kind === 'traffic') return t.clicks > 0 ? t.spend / t.clicks : 0;
  if (kind === 'leads') return costPerResult(t);
  return t.cpa;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface PeerContext {
  /** Cost metric of every same-account, same-kind campaign with delivery (including this one). */
  peerCosts: number[];
}

/**
 * Performance vs goal: 1.0 = exactly on goal, 2.0 = twice as good, 0.5 = half as good.
 * null = nothing to compare with (no goal and too few peers) -> "unrated", never a red flag.
 */
export function performanceRatio(
  kind: CampaignKind,
  t: Totals,
  target: AccountTarget,
  peers: PeerContext | null,
  cfg: EvalConfig = DEFAULT_EVAL_CONFIG,
): number | null {
  if (t.spend <= 0) return null;
  if (kind === 'sales') {
    if (t.conversions <= 0) return 0;
    const roasScore = target.targetRoas > 0 ? t.roas / target.targetRoas : Infinity;
    const cpaScore = target.targetCpa > 0 ? target.targetCpa / t.cpa : Infinity;
    const r = Math.min(roasScore, cpaScore);
    return Number.isFinite(r) ? r : null;
  }
  if (kind === 'leads' && t.conversions > 0 && target.targetCpa > 0) {
    // Purchases without value (e.g. WhatsApp sales): judge them by CPA.
    return target.targetCpa / t.cpa;
  }
  // Leads (conversations only), traffic and awareness: benchmark against the account's peers.
  const own = costMetric(kind, t);
  if (own <= 0) return kind === 'awareness' ? null : 0;
  const costs = (peers?.peerCosts ?? []).filter((x) => x > 0);
  if (costs.length < cfg.minPeers) return null;
  return median(costs) / own;
}

export function healthFromRatio(ratio: number | null, spend: number, freqOverCap: boolean, cfg: EvalConfig = DEFAULT_EVAL_CONFIG): Health {
  if (spend <= 0) return 'inactive';
  if (ratio === null) return freqOverCap ? 'warning' : 'unrated';
  let h: Health = ratio >= cfg.scaleFrom ? 'good' : ratio >= cfg.cutBelow ? 'warning' : 'critical';
  // An audience past its frequency cap is not "on target", whatever ROAS says today.
  if (freqOverCap && h === 'good') h = 'warning';
  return h;
}

/** The one ladder every recommendation uses. */
export function verdictFromRatio(ratio: number, cfg: EvalConfig = DEFAULT_EVAL_CONFIG): Verdict {
  if (ratio < cfg.pauseBelow) return 'pause';
  if (ratio < cfg.cutBelow) return 'cut';
  if (ratio < cfg.scaleFrom) return 'watch';
  return 'scale';
}

export interface DataQuality {
  /** Days with spend >= 1 in the window. */
  activeDays: number;
  conversions: number;
  sufficient: boolean;
  confidence: Confidence;
}

export function dataQuality(
  rows: readonly Pick<CampaignDailyMetric, 'date' | 'spend' | 'conversions' | 'conversations'>[],
  range: DateRange,
  kind: CampaignKind,
  cfg: EvalConfig = DEFAULT_EVAL_CONFIG,
): DataQuality {
  let activeDays = 0;
  let conversions = 0;
  for (const r of rows) {
    if (r.date < range.start || r.date > range.end) continue;
    if (r.spend >= 1) activeDays++;
    conversions += r.conversions > 0 ? r.conversions : kind === 'leads' ? (r.conversations ?? 0) : 0;
  }
  // Awareness/traffic don't need conversions to be judged.
  const needsConversions = kind === 'sales' || kind === 'leads';
  const enoughConv = !needsConversions || conversions >= cfg.minConversions;
  const sufficient = activeDays >= cfg.minActiveDays && enoughConv;
  const high = activeDays >= cfg.highConfidenceDays && (!needsConversions || conversions >= cfg.highConfidenceConversions);
  return { activeDays, conversions, sufficient, confidence: !sufficient ? 'low' : high ? 'high' : 'medium' };
}

const SEASONAL_RE =
  /\b(sale|spring|summer|autumn|fall|winter|ramadan|eid|black ?friday|white ?friday|cyber ?monday|christmas|xmas|valentine|new ?year|back ?to ?school|bf\d{0,4}|q[1-4] ?launch)\b|عيد|رمضان|بلاك|الجمعة البيضاء|عروض|تخفيضات|موسم|الصيف|الشتاء/i;

/** A name like "Spring Sale" or "BF26" suggests a promotion that may have ended. */
export function looksSeasonal(name: string): boolean {
  return SEASONAL_RE.test(name);
}
