import type { Channel, CreativeDailyMetric } from '../data/types';
import { groupBy, rangeEnding } from '../lib/metrics';
import { fmtMoney } from '../lib/format';
import { detectAnomalies, DEFAULT_ANOMALY_CONFIG } from './anomalies';
import { detectFatigue } from './fatigue';
import { computePacing } from './pacing';
import { summarizeCampaigns, type CampaignSummary } from './summary';
import type { RulesInput } from './types';

export type RecommendationType =
  | 'shift_budget'
  | 'pause_campaign'
  | 'raise_budget'
  | 'lower_budget'
  | 'refresh_creative'
  | 'fix_delivery'
  | 'expand_audience';

export type Priority = 'high' | 'medium' | 'low';

export interface Recommendation {
  id: string;
  type: RecommendationType;
  priority: Priority;
  title: string;
  rationale: string;
  impact: {
    kind: 'revenue' | 'savings' | 'protect';
    /** Estimated monthly value in account currency. */
    monthly: number;
    label: string;
  };
  campaignIds: string[];
  creativeIds: string[];
  channels: Channel[];
}

export interface RecommendationConfig {
  windowDays: number;
  minSpend: number;
  loserRoasRatio: number;
  winnerRoasRatio: number;
  pauseRoasRatio: number;
  /** share of returns kept when scaling (diminishing returns) */
  scaleEfficiency: number;
  frequencyMax: number;
}

export const DEFAULT_RECOMMENDATION_CONFIG: RecommendationConfig = {
  windowDays: 14,
  minSpend: 500,
  loserRoasRatio: 0.6,
  winnerRoasRatio: 1.2,
  pauseRoasRatio: 0.25,
  scaleEfficiency: 0.7,
  frequencyMax: 4,
};

const DAYS_PER_MONTH = 30;
// Uses the display currency of the loaded accounts (USD in demo, EGP etc. for real Meta accounts).
const money = (n: number) => fmtMoney(Math.round(n));
const x = (n: number) => n.toFixed(1);

function priorityFor(monthly: number, forceHigh = false): Priority {
  if (forceHigh || monthly >= 5000) return 'high';
  if (monthly >= 1000) return 'medium';
  return 'low';
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Deterministic rules engine. Same input -> same recommendations, in the same order.
 */
export function generateRecommendations(
  input: RulesInput,
  config: RecommendationConfig = DEFAULT_RECOMMENDATION_CONFIG,
): Recommendation[] {
  const { campaigns, campaignDaily, creatives, creativeDaily, asOf, targets } = input;
  const range = rangeEnding(asOf, config.windowDays);
  const summaries = summarizeCampaigns(campaigns, campaignDaily, range, targets);
  const perDay = (n: number) => n / config.windowDays;
  const recs: Recommendation[] = [];
  const handled = new Set<string>();

  const eligible = summaries.filter((s) => s.campaign.status !== 'PAUSED' && s.totals.spend >= config.minSpend);

  // --- Pause money-losers far below goal --------------------------------------
  for (const s of eligible) {
    if (s.totals.roas >= s.target.targetRoas * config.pauseRoasRatio) continue;
    const monthlySpend = perDay(s.totals.spend) * DAYS_PER_MONTH;
    const monthlyRevenue = perDay(s.totals.revenue) * DAYS_PER_MONTH;
    recs.push({
      id: `pause_campaign:${s.campaign.id}`,
      type: 'pause_campaign',
      priority: priorityFor(monthlySpend - monthlyRevenue),
      title: `Pause ${s.campaign.name} (ROAS ${s.totals.roas.toFixed(2)})`,
      rationale: `ROAS is ${Math.round((s.totals.roas / s.target.targetRoas) * 100)}% of the ${s.target.targetRoas.toFixed(1)}x goal over the last ${config.windowDays} days. Pausing frees ~${money(monthlySpend)}/mo for campaigns above goal.`,
      impact: { kind: 'savings', monthly: monthlySpend - monthlyRevenue, label: 'net loss avoided / mo' },
      campaignIds: [s.campaign.id],
      creativeIds: [],
      channels: [s.campaign.channel],
    });
    handled.add(s.campaign.id);
  }

  // --- Shift budget from losers to winners ------------------------------------
  const winners = eligible
    .filter(
      (s) =>
        s.campaign.status === 'ACTIVE' &&
        s.totals.roas >= s.target.targetRoas * config.winnerRoasRatio &&
        s.frequency <= config.frequencyMax,
    )
    .sort((a, b) => b.totals.roas - a.totals.roas || a.campaign.id.localeCompare(b.campaign.id));
  const losers = eligible
    .filter((s) => !handled.has(s.campaign.id) && s.totals.roas < s.target.targetRoas * config.loserRoasRatio)
    .sort((a, b) => a.totals.roas - b.totals.roas || a.campaign.id.localeCompare(b.campaign.id));

  const used = new Set<string>();
  for (const loser of losers) {
    if (!winners.length) break;
    const pick = (pool: CampaignSummary[]) => pool.find((w) => !used.has(w.campaign.id)) ?? pool[0];
    const sameChannel = winners.filter((w) => w.campaign.channel === loser.campaign.channel);
    const winner = sameChannel.length ? pick(sameChannel) : pick(winners);
    used.add(winner.campaign.id);
    const share = loser.totals.roas < 1 ? 0.15 : 0.1;
    const shiftPerDay = loser.campaign.dailyBudget * share;
    const monthly = shiftPerDay * DAYS_PER_MONTH;
    const gain = monthly * (winner.totals.roas * config.scaleEfficiency - loser.totals.roas);
    if (gain <= 0) continue;
    recs.push({
      id: `shift_budget:${loser.campaign.id}:${winner.campaign.id}`,
      type: 'shift_budget',
      priority: priorityFor(gain),
      title: `Shift ${Math.round(share * 100)}% budget from ${loser.campaign.name} (ROAS ${loser.totals.roas.toFixed(1)}) to ${winner.campaign.name} (ROAS ${winner.totals.roas.toFixed(1)})`,
      rationale: `Move ${money(shiftPerDay)}/day. Assumes the receiving campaign keeps ${Math.round(config.scaleEfficiency * 100)}% of its current efficiency at higher spend.`,
      impact: { kind: 'revenue', monthly: gain, label: 'extra revenue / mo' },
      campaignIds: [loser.campaign.id, winner.campaign.id],
      creativeIds: [],
      channels: [...new Set([loser.campaign.channel, winner.campaign.channel])],
    });
    handled.add(loser.campaign.id);
  }

  // --- Delivery stopped & saturated audiences (from anomaly rules) ------------
  const anomalies = detectAnomalies(
    { campaigns, campaignDaily, asOf },
    { ...DEFAULT_ANOMALY_CONFIG, frequencyMax: config.frequencyMax },
  );
  const byId = new Map(summaries.map((s) => [s.campaign.id, s]));
  for (const a of anomalies) {
    const s = byId.get(a.campaignId);
    if (!s) continue;
    if (a.type === 'spend_stopped') {
      const atRisk = a.baseline * Math.max(s.totals.roas, 0.5) * DAYS_PER_MONTH;
      recs.push({
        id: `fix_delivery:${a.campaignId}`,
        type: 'fix_delivery',
        priority: 'high',
        title: `Investigate stopped delivery on ${a.campaignName}`,
        rationale: `${a.title}. Status is active but nothing is spending: check payment method, ad approvals, end dates and bid caps.`,
        impact: { kind: 'protect', monthly: atRisk, label: 'revenue at risk / mo' },
        campaignIds: [a.campaignId],
        creativeIds: [],
        channels: [a.channel],
      });
      handled.add(a.campaignId);
    } else if (a.type === 'high_frequency') {
      const protect = perDay(s.totals.revenue) * DAYS_PER_MONTH * 0.1;
      recs.push({
        id: `expand_audience:${a.campaignId}`,
        type: 'expand_audience',
        priority: priorityFor(protect),
        title: `Expand audience on ${a.campaignName} (frequency ${x(a.current)})`,
        rationale: `Frequency is over ${config.frequencyMax}. Widen the lookback window or exclude recent purchasers to keep CTR from decaying.`,
        impact: { kind: 'protect', monthly: protect, label: 'revenue protected / mo (est. 10%)' },
        campaignIds: [a.campaignId],
        creativeIds: [],
        channels: [a.channel],
      });
    }
  }

  // --- Budget pacing ----------------------------------------------------------
  for (const s of summaries) {
    if (handled.has(s.campaign.id) || s.campaign.status !== 'ACTIVE') continue;
    const p = computePacing(s.campaign, campaignDaily, asOf);
    // No monthly plan entered (Meta has no monthly budgets): nothing to pace against.
    if (p.daysRemaining <= 0 || p.monthlyBudget <= 0) continue;
    if (p.status === 'over') {
      const overage = p.projected - p.monthlyBudget;
      if (s.health === 'good') {
        const gain = overage * s.totals.roas * config.scaleEfficiency;
        recs.push({
          id: `raise_budget:${s.campaign.id}`,
          type: 'raise_budget',
          priority: priorityFor(gain),
          title: `Raise the monthly budget of ${s.campaign.name} by ${money(overage)}`,
          rationale: `Projected to overspend its plan by ${Math.round((p.pacing - 1) * 100)}%, but ROAS ${s.totals.roas.toFixed(1)}x beats goal. Fund it rather than throttling a winner.`,
          impact: { kind: 'revenue', monthly: gain, label: 'revenue kept / mo' },
          campaignIds: [s.campaign.id],
          creativeIds: [],
          channels: [s.campaign.channel],
        });
      } else {
        recs.push({
          id: `lower_budget:${s.campaign.id}`,
          type: 'lower_budget',
          priority: priorityFor(overage),
          title: `Lower the daily budget of ${s.campaign.name} to ${money(p.recommendedDaily)}`,
          rationale: `Projected to overspend its plan by ${money(overage)} while missing goal (ROAS ${s.totals.roas.toFixed(1)}x vs ${s.target.targetRoas.toFixed(1)}x).`,
          impact: { kind: 'savings', monthly: overage, label: 'overspend avoided' },
          campaignIds: [s.campaign.id],
          creativeIds: [],
          channels: [s.campaign.channel],
        });
      }
    } else if (p.status === 'under' && s.health === 'good') {
      const headroom = p.monthlyBudget - p.projected;
      const gain = headroom * s.totals.roas * config.scaleEfficiency;
      recs.push({
        id: `raise_budget:${s.campaign.id}`,
        type: 'raise_budget',
        priority: priorityFor(gain),
        title: `Increase the daily budget of ${s.campaign.name} to ${money(p.recommendedDaily)}`,
        rationale: `Under-pacing (${Math.round(p.pacing * 100)}% of plan) while beating its ROAS goal. ${money(headroom)} of planned budget would go unspent.`,
        impact: { kind: 'revenue', monthly: gain, label: 'extra revenue / mo' },
        campaignIds: [s.campaign.id],
        creativeIds: [],
        channels: [s.campaign.channel],
      });
    }
  }

  // --- Creative fatigue -------------------------------------------------------
  const creativeRows = groupBy<CreativeDailyMetric>(creativeDaily, (r) => r.creativeId);
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  for (const cr of creatives) {
    const camp = campaignById.get(cr.campaignId);
    if (!camp || camp.status === 'PAUSED') continue;
    const rows = creativeRows[cr.id] ?? [];
    const f = detectFatigue(rows, asOf);
    if (f.status !== 'fatigued') continue;
    const last7 = rows.filter((r) => r.date > rangeEnding(asOf, 8).start);
    const revenue7 = last7.reduce((sum, r) => sum + r.revenue, 0);
    const recovered = (revenue7 / 7) * DAYS_PER_MONTH * Math.min(0.5, Math.abs(f.ctrChange));
    recs.push({
      id: `refresh_creative:${cr.id}`,
      type: 'refresh_creative',
      priority: priorityFor(recovered),
      title: `Refresh creative "${cr.name}" (fatigued)`,
      rationale: `Frequency +${Math.round(f.frequencyChange * 100)}% while CTR ${Math.round(f.ctrChange * 100)}% week over week in ${camp.name}. Launch 2-3 new variants on the same hook.`,
      impact: { kind: 'revenue', monthly: recovered, label: 'revenue recovered / mo' },
      campaignIds: [cr.campaignId],
      creativeIds: [cr.id],
      channels: [cr.channel],
    });
  }

  return recs.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      b.impact.monthly - a.impact.monthly ||
      a.id.localeCompare(b.id),
  );
}
