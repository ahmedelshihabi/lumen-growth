import type { Campaign, CampaignDailyMetric, DateRange } from '../data/types';
import { aggregate, filterRange, groupBy, latestFrequency, type Totals } from '../lib/metrics';
import {
  DEFAULT_EVAL_CONFIG,
  audienceType,
  campaignKind,
  costPerResult,
  dataQuality,
  frequencyCap,
  healthFromRatio,
  performanceRatio,
  verdictFromRatio,
  type AudienceType,
  type CampaignKind,
  type DataQuality,
  type EvalConfig,
  type Health,
  type Verdict,
} from './evaluate';
import { targetFor, type AccountTarget, type TargetsByAccount } from './types';

export interface CampaignSummary {
  campaign: Campaign;
  totals: Totals;
  frequency: number;
  target: AccountTarget;
  /** What the campaign is judged on (from its objective). */
  kind: CampaignKind;
  audience: AudienceType;
  frequencyCap: number;
  frequencyOverCap: boolean;
  /** Performance vs goal (1 = on goal); null = no goal or peers to compare with. */
  ratio: number | null;
  health: Health;
  /** Ladder decision; null when the ratio is unknown. */
  verdict: Verdict | null;
  quality: DataQuality;
  /** The window these numbers cover. */
  range: DateRange;
}

const costFor = (kind: CampaignKind, t: Totals) =>
  kind === 'awareness' ? t.cpm : kind === 'traffic' ? (t.clicks > 0 ? t.spend / t.clicks : 0) : kind === 'leads' ? costPerResult(t) : t.cpa;

/** The one place campaigns are evaluated. Every page and rule reads these fields. */
export function summarizeCampaigns(
  campaigns: readonly Campaign[],
  daily: readonly CampaignDailyMetric[],
  range: DateRange,
  targets: TargetsByAccount,
  cfg: EvalConfig = DEFAULT_EVAL_CONFIG,
): CampaignSummary[] {
  const inRange = filterRange(daily, range);
  const byCampaign = groupBy(inRange, (r) => r.campaignId);
  const base = campaigns.map((campaign) => {
    const rows = byCampaign[campaign.id] ?? [];
    const totals = aggregate(rows);
    return { campaign, rows, totals, kind: campaignKind(campaign, totals) };
  });

  // Peers for objectives without an explicit goal: same account, same kind, with delivery.
  const peerCosts = new Map<string, number[]>();
  for (const b of base) {
    if (b.totals.spend <= 0) continue;
    const key = `${b.campaign.accountId}|${b.kind}`;
    const list = peerCosts.get(key) ?? [];
    list.push(costFor(b.kind, b.totals));
    peerCosts.set(key, list);
  }

  return base.map(({ campaign, rows, totals, kind }) => {
    const target = targetFor(targets, campaign.accountId);
    const frequency = latestFrequency(rows);
    const cap = frequencyCap(campaign, cfg);
    const frequencyOverCap = totals.spend > 0 && frequency > cap;
    const ratio = performanceRatio(kind, totals, target, { peerCosts: peerCosts.get(`${campaign.accountId}|${kind}`) ?? [] }, cfg);
    return {
      campaign,
      totals,
      frequency,
      target,
      kind,
      audience: audienceType(campaign),
      frequencyCap: cap,
      frequencyOverCap,
      ratio,
      health: healthFromRatio(ratio, totals.spend, frequencyOverCap, cfg),
      verdict: ratio === null ? null : verdictFromRatio(ratio, cfg),
      quality: dataQuality(rows, range, kind, cfg),
      range,
    };
  });
}
