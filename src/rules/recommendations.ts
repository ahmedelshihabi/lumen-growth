import type { Channel, CreativeDailyMetric } from '../data/types';
import { groupBy, rangeEnding } from '../lib/metrics';
import { fmtMoney } from '../lib/format';
import { detectAnomalies, DEFAULT_ANOMALY_CONFIG } from './anomalies';
import { detectFatigue } from './fatigue';
import { computePacing } from './pacing';
import { summarizeCampaigns, type CampaignSummary } from './summary';
import { lacksValueTracking } from './health';
import type { RulesInput } from './types';
import { msg, renderEn, type Msg } from './msg';

export type RecommendationType =
  | 'shift_budget'
  | 'pause_campaign'
  | 'raise_budget'
  | 'lower_budget'
  | 'refresh_creative'
  | 'fix_delivery'
  | 'expand_audience'
  | 'relaunch_campaign';

export type Priority = 'high' | 'medium' | 'low';

export interface Recommendation {
  id: string;
  type: RecommendationType;
  priority: Priority;
  /** English text; the UI renders the translatable `titleMsg` / `rationaleMsg` instead. */
  title: string;
  rationale: string;
  titleMsg: Msg;
  rationaleMsg: Msg;
  impact: {
    kind: 'revenue' | 'savings' | 'protect';
    /** Estimated monthly value in account currency. */
    monthly: number;
    label: string;
    labelMsg: Msg;
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
  /** How far back to look for paused winners worth relaunching. */
  relaunchLookbackDays: number;
  relaunchMinConversions: number;
}

export const DEFAULT_RECOMMENDATION_CONFIG: RecommendationConfig = {
  windowDays: 14,
  minSpend: 500,
  loserRoasRatio: 0.6,
  winnerRoasRatio: 1.2,
  pauseRoasRatio: 0.25,
  scaleEfficiency: 0.7,
  frequencyMax: 4,
  relaunchLookbackDays: 30,
  relaunchMinConversions: 5,
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

const texts = (titleMsg: Msg, rationaleMsg: Msg) => ({
  titleMsg,
  rationaleMsg,
  title: renderEn(titleMsg),
  rationale: renderEn(rationaleMsg),
});

const impact = (kind: Recommendation['impact']['kind'], monthly: number, labelMsg: Msg): Recommendation['impact'] => ({
  kind,
  monthly,
  labelMsg,
  label: renderEn(labelMsg),
});

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

  // Campaigns without purchase value (click-to-WhatsApp etc.) read ROAS 0; never pause or
  // drain them because of ROAS.
  const eligible = summaries.filter(
    (s) => s.campaign.status !== 'PAUSED' && s.totals.spend >= config.minSpend && !lacksValueTracking(s.totals),
  );

  // --- Pause money-losers far below goal --------------------------------------
  for (const s of eligible) {
    if (s.totals.roas >= s.target.targetRoas * config.pauseRoasRatio) continue;
    const monthlySpend = perDay(s.totals.spend) * DAYS_PER_MONTH;
    const monthlyRevenue = perDay(s.totals.revenue) * DAYS_PER_MONTH;
    recs.push({
      id: `pause_campaign:${s.campaign.id}`,
      type: 'pause_campaign',
      priority: priorityFor(monthlySpend - monthlyRevenue),
      ...texts(
        msg('recMsg.pause.title', { name: s.campaign.name, roas: s.totals.roas.toFixed(2) }),
        msg('recMsg.pause.rationale', {
          pct: `${Math.round((s.totals.roas / s.target.targetRoas) * 100)}%`,
          goal: `${s.target.targetRoas.toFixed(1)}x`,
          days: config.windowDays,
          amount: money(monthlySpend),
        }),
      ),
      impact: impact('savings', monthlySpend - monthlyRevenue, msg('recMsg.label.netLoss')),
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
      ...texts(
        msg('recMsg.shift.title', {
          pct: `${Math.round(share * 100)}%`,
          from: loser.campaign.name,
          fromRoas: loser.totals.roas.toFixed(1),
          to: winner.campaign.name,
          toRoas: winner.totals.roas.toFixed(1),
        }),
        msg('recMsg.shift.rationale', {
          amount: money(shiftPerDay),
          eff: `${Math.round(config.scaleEfficiency * 100)}%`,
        }),
      ),
      impact: impact('revenue', gain, msg('recMsg.label.extraRevenue')),
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
        ...texts(
          msg('recMsg.delivery.title', { name: a.campaignName }),
          a.titleMsg.key === 'anomalyMsg.stopped.titleOne'
            ? msg('recMsg.delivery.rationaleOne')
            : msg('recMsg.delivery.rationale', a.titleMsg.vars),
        ),
        impact: impact('protect', atRisk, msg('recMsg.label.atRisk')),
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
        ...texts(
          msg('recMsg.audience.title', { name: a.campaignName, freq: x(a.current) }),
          msg('recMsg.audience.rationale', { max: config.frequencyMax }),
        ),
        impact: impact('protect', protect, msg('recMsg.label.protected')),
        campaignIds: [a.campaignId],
        creativeIds: [],
        channels: [a.channel],
      });
    }
  }

  // --- Relaunch paused winners -------------------------------------------------
  // A campaign someone paused that was beating its goals is the cheapest growth there is:
  // proven audience, proven creative.
  const lookback = rangeEnding(asOf, config.relaunchLookbackDays);
  for (const s of summarizeCampaigns(campaigns, campaignDaily, lookback, targets)) {
    if (s.campaign.status !== 'PAUSED') continue;
    if (s.totals.spend < config.minSpend || s.totals.conversions < config.relaunchMinConversions) continue;
    if (lacksValueTracking(s.totals) || s.health !== 'good') continue;
    const activeDays = new Set(
      campaignDaily
        .filter((r) => r.campaignId === s.campaign.id && r.spend >= 1 && r.date >= lookback.start && r.date <= lookback.end)
        .map((r) => r.date),
    ).size;
    if (activeDays === 0) continue;
    const dailySpend = s.totals.spend / activeDays;
    const monthly = (s.totals.revenue / activeDays) * DAYS_PER_MONTH * config.scaleEfficiency;
    recs.push({
      id: `relaunch_campaign:${s.campaign.id}`,
      type: 'relaunch_campaign',
      priority: priorityFor(monthly),
      ...texts(
        msg('recMsg.relaunch.title', { name: s.campaign.name, roas: `${s.totals.roas.toFixed(2)}x` }),
        msg('recMsg.relaunch.rationale', {
          days: activeDays,
          spend: money(s.totals.spend),
          roas: `${s.totals.roas.toFixed(2)}x`,
          goal: `${s.target.targetRoas.toFixed(1)}x`,
          cpa: money(s.totals.cpa),
          daily: money(dailySpend),
        }),
      ),
      impact: impact('revenue', monthly, msg('recMsg.label.relaunch')),
      campaignIds: [s.campaign.id],
      creativeIds: [],
      channels: [s.campaign.channel],
    });
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
          ...texts(
            msg('recMsg.raiseMonthly.title', { name: s.campaign.name, amount: money(overage) }),
            msg('recMsg.raiseMonthly.rationale', {
              pct: `${Math.round((p.pacing - 1) * 100)}%`,
              roas: `${s.totals.roas.toFixed(1)}x`,
            }),
          ),
          impact: impact('revenue', gain, msg('recMsg.label.revenueKept')),
          campaignIds: [s.campaign.id],
          creativeIds: [],
          channels: [s.campaign.channel],
        });
      } else {
        recs.push({
          id: `lower_budget:${s.campaign.id}`,
          type: 'lower_budget',
          priority: priorityFor(overage),
          ...texts(
            msg('recMsg.lower.title', { name: s.campaign.name, amount: money(p.recommendedDaily) }),
            msg('recMsg.lower.rationale', {
              amount: money(overage),
              roas: `${s.totals.roas.toFixed(1)}x`,
              goal: `${s.target.targetRoas.toFixed(1)}x`,
            }),
          ),
          impact: impact('savings', overage, msg('recMsg.label.overspend')),
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
        ...texts(
          msg('recMsg.raiseDaily.title', { name: s.campaign.name, amount: money(p.recommendedDaily) }),
          msg('recMsg.raiseDaily.rationale', { pct: `${Math.round(p.pacing * 100)}%`, amount: money(headroom) }),
        ),
        impact: impact('revenue', gain, msg('recMsg.label.extraRevenue')),
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
      ...texts(
        msg('recMsg.creative.title', { name: cr.name }),
        msg('recMsg.creative.rationale', {
          freq: `+${Math.round(f.frequencyChange * 100)}%`,
          ctr: `${Math.round(f.ctrChange * 100)}%`,
          campaign: camp.name,
        }),
      ),
      impact: impact('revenue', recovered, msg('recMsg.label.recovered')),
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
