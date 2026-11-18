import type { Channel, CreativeDailyMetric, DateRange } from '../data/types';
import { groupBy, rangeEnding } from '../lib/metrics';
import { currencyScale, fmtMoney } from '../lib/format';
import { detectAnomalies, DEFAULT_ANOMALY_CONFIG } from './anomalies';
import { detectFatigue } from './fatigue';
import { computePacing, pacingAdvice } from './pacing';
import { summarizeCampaigns, type CampaignSummary } from './summary';
import { DEFAULT_EVAL_CONFIG, costPerResult, looksSeasonal, type Confidence, type EvalConfig } from './evaluate';
import { targetFor, type RulesInput } from './types';
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
  /** Extra caution shown with the recommendation (e.g. "this looks like an ended sale"). */
  warningMsg?: Msg;
  impact: {
    kind: 'revenue' | 'savings' | 'protect';
    /** Estimated monthly value in account currency. 0 when the data is too thin to estimate. */
    monthly: number;
    label: string;
    labelMsg: Msg;
  };
  /** How much to trust it, and the data it is based on. */
  confidence: Confidence;
  window: DateRange & { activeDays: number };
  campaignIds: string[];
  creativeIds: string[];
  channels: Channel[];
}

export interface RecommendationConfig {
  windowDays: number;
  /** Minimum spend in the window, in USD (scaled to the account currency). */
  minSpend: number;
  /** Share of the daily budget moved away from a "cut" campaign. */
  cutShare: number;
  /** share of returns kept when scaling (diminishing returns) */
  scaleEfficiency: number;
  /** How far back to look for paused winners worth relaunching. */
  relaunchLookbackDays: number;
  eval: EvalConfig;
}

export const DEFAULT_RECOMMENDATION_CONFIG: RecommendationConfig = {
  windowDays: 14,
  minSpend: 500,
  cutShare: 0.2,
  scaleEfficiency: 0.7,
  relaunchLookbackDays: 30,
  eval: DEFAULT_EVAL_CONFIG,
};

const DAYS_PER_MONTH = 30;
const money = (n: number) => fmtMoney(Math.round(n));
const x = (n: number) => n.toFixed(1);
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Priority bands are in USD and scaled to the display currency (EGP 250k, not EGP 5k, is "high"). */
function priorityFor(monthly: number, confidence: Confidence, forceHigh = false): Priority {
  if (confidence === 'low') return 'low';
  const usd = monthly / currencyScale();
  if (forceHigh || usd >= 5000) return 'high';
  if (usd >= 1000) return 'medium';
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
  monthly: Math.max(0, monthly),
  labelMsg,
  label: renderEn(labelMsg),
});

const basis = (s: CampaignSummary) => ({
  confidence: s.quality.confidence,
  window: { ...s.range, activeDays: s.quality.activeDays },
});

/** "ROAS 0.8x" for sales, "cost per result EGP 120" otherwise. */
const perfLabel = (s: CampaignSummary) =>
  s.kind === 'sales' ? `ROAS ${s.totals.roas.toFixed(2)}x` : `${money(s.kind === 'leads' ? costPerResult(s.totals) : s.totals.cpm)}`;

/**
 * Deterministic rules engine. Same input -> same recommendations, in the same order.
 * Every decision goes through evaluate.ts (one ladder, objective-aware, minimum data).
 */
export function generateRecommendations(
  input: RulesInput,
  config: RecommendationConfig = DEFAULT_RECOMMENDATION_CONFIG,
): Recommendation[] {
  const { campaigns, campaignDaily, creatives, creativeDaily, asOf, targets } = input;
  const cfg = input.evalConfig ?? config.eval;
  const range = rangeEnding(asOf, config.windowDays);
  const summaries = summarizeCampaigns(campaigns, campaignDaily, range, targets, cfg);
  const perDay = (n: number, s: CampaignSummary) => n / Math.max(1, s.quality.activeDays);
  const recs: Recommendation[] = [];
  const handled = new Set<string>();
  const minSpend = config.minSpend * currencyScale();

  // Judged campaigns: running, enough spend AND enough data, with a goal to compare to.
  // Awareness is never paused or cut on performance (it is not bought for ROAS).
  const judged = summaries.filter(
    (s) =>
      s.campaign.status !== 'PAUSED' &&
      s.totals.spend >= minSpend &&
      s.quality.sufficient &&
      s.verdict !== null &&
      s.kind !== 'awareness',
  );

  // --- Ladder step 1: pause (< 50% of goal) ------------------------------------
  for (const s of judged) {
    if (s.verdict !== 'pause') continue;
    const monthlySpend = perDay(s.totals.spend, s) * DAYS_PER_MONTH;
    const monthlyLoss = monthlySpend - perDay(s.totals.revenue, s) * DAYS_PER_MONTH;
    const sales = s.kind === 'sales';
    recs.push({
      id: `pause_campaign:${s.campaign.id}`,
      type: 'pause_campaign',
      priority: priorityFor(sales ? monthlyLoss : monthlySpend, s.quality.confidence),
      ...texts(
        sales
          ? msg('recMsg.pause.title', { name: s.campaign.name, roas: s.totals.roas.toFixed(2) })
          : msg('recMsg.pauseCost.title', { name: s.campaign.name, cost: perfLabel(s) }),
        msg('recMsg.pause.ladder', {
          pct: pct(s.ratio!),
          days: s.quality.activeDays,
          amount: money(monthlySpend),
        }),
      ),
      impact: sales
        ? impact('savings', monthlyLoss, msg('recMsg.label.netLoss'))
        : impact('savings', monthlySpend * (1 - s.ratio!), msg('recMsg.label.wasted')),
      ...basis(s),
      campaignIds: [s.campaign.id],
      creativeIds: [],
      channels: [s.campaign.channel],
    });
    handled.add(s.campaign.id);
  }

  // --- Ladder step 2: cut (50-80% of goal) -> shift to a winner, or lower -----
  const winners = judged
    .filter((s) => s.campaign.status === 'ACTIVE' && s.verdict === 'scale' && s.kind === 'sales' && !s.frequencyOverCap)
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || a.campaign.id.localeCompare(b.campaign.id));
  const used = new Set<string>();
  for (const loser of judged.filter((s) => s.verdict === 'cut' && !handled.has(s.campaign.id))) {
    const shiftPerDay = loser.campaign.dailyBudget * config.cutShare;
    const monthly = shiftPerDay * DAYS_PER_MONTH;
    const sameChannel = winners.filter((w) => w.campaign.channel === loser.campaign.channel);
    const pool = sameChannel.length ? sameChannel : winners;
    const winner = pool.find((w) => !used.has(w.campaign.id)) ?? pool[0];
    const gain = winner && loser.kind === 'sales' ? monthly * (winner.totals.roas * config.scaleEfficiency - loser.totals.roas) : 0;
    if (winner && gain > 0) {
      used.add(winner.campaign.id);
      recs.push({
        id: `shift_budget:${loser.campaign.id}:${winner.campaign.id}`,
        type: 'shift_budget',
        priority: priorityFor(gain, loser.quality.confidence),
        ...texts(
          msg('recMsg.shift.title', {
            pct: pct(config.cutShare),
            from: loser.campaign.name,
            fromRoas: loser.totals.roas.toFixed(1),
            to: winner.campaign.name,
            toRoas: winner.totals.roas.toFixed(1),
          }),
          msg('recMsg.shift.ladder', {
            amount: money(shiftPerDay),
            pct: pct(loser.ratio!),
            eff: pct(config.scaleEfficiency),
          }),
        ),
        impact: impact('revenue', gain, msg('recMsg.label.extraRevenue')),
        ...basis(loser),
        campaignIds: [loser.campaign.id, winner.campaign.id],
        creativeIds: [],
        channels: [...new Set([loser.campaign.channel, winner.campaign.channel])],
      });
    } else {
      recs.push({
        id: `lower_budget:${loser.campaign.id}`,
        type: 'lower_budget',
        priority: priorityFor(monthly * (1 - loser.ratio!), loser.quality.confidence),
        ...texts(
          msg('recMsg.cut.title', { name: loser.campaign.name, pct: pct(config.cutShare), amount: money(loser.campaign.dailyBudget * (1 - config.cutShare)) }),
          msg('recMsg.cut.rationale', { pct: pct(loser.ratio!), days: loser.quality.activeDays, perf: perfLabel(loser) }),
        ),
        impact: impact('savings', monthly * (1 - loser.ratio!), msg('recMsg.label.wasted')),
        ...basis(loser),
        campaignIds: [loser.campaign.id],
        creativeIds: [],
        channels: [loser.campaign.channel],
      });
    }
    handled.add(loser.campaign.id);
  }

  // --- Frequency over the cap for its audience type ----------------------------
  for (const s of summaries) {
    if (s.campaign.status === 'PAUSED' || !s.frequencyOverCap || s.totals.spend < minSpend) continue;
    const protect = perDay(s.totals.revenue, s) * DAYS_PER_MONTH * 0.1;
    recs.push({
      id: `expand_audience:${s.campaign.id}`,
      type: 'expand_audience',
      priority: priorityFor(protect, s.quality.confidence),
      ...texts(
        msg('recMsg.audience.title', { name: s.campaign.name, freq: x(s.frequency) }),
        msg(s.audience === 'retargeting' ? 'recMsg.audience.rationaleRtg' : 'recMsg.audience.rationale', { max: s.frequencyCap }),
      ),
      impact: impact('protect', protect, msg('recMsg.label.protected')),
      ...basis(s),
      campaignIds: [s.campaign.id],
      creativeIds: [],
      channels: [s.campaign.channel],
    });
  }

  // --- Delivery stopped (from the anomaly rules) ----------------------------------
  const byId = new Map(summaries.map((s) => [s.campaign.id, s]));
  for (const a of detectAnomalies({ campaigns, campaignDaily, asOf }, input.anomalyConfig ?? DEFAULT_ANOMALY_CONFIG)) {
    if (a.type !== 'spend_stopped') continue;
    const s = byId.get(a.campaignId);
    if (!s) continue;
    const atRisk = a.baseline * Math.max(s.totals.roas, 0.5) * DAYS_PER_MONTH;
    recs.push({
      id: `fix_delivery:${a.campaignId}`,
      type: 'fix_delivery',
      priority: 'high',
      ...texts(
        msg('recMsg.delivery.title', { name: a.campaignName }),
        a.titleMsg.key === 'anomalyMsg.stopped.titleOne' ? msg('recMsg.delivery.rationaleOne') : msg('recMsg.delivery.rationale', a.titleMsg.vars),
      ),
      impact: impact('protect', atRisk, msg('recMsg.label.atRisk')),
      confidence: 'high',
      window: { ...s.range, activeDays: s.quality.activeDays },
      campaignIds: [a.campaignId],
      creativeIds: [],
      channels: [a.channel],
    });
    handled.add(a.campaignId);
  }

  // --- Pacing, performance-aware (same function as the Pacing page) -------------
  for (const s of summaries) {
    if (handled.has(s.campaign.id) || s.campaign.status !== 'ACTIVE') continue;
    const p = computePacing(s.campaign, campaignDaily, asOf);
    const advice = pacingAdvice(p, s.quality.sufficient ? s.verdict : null);
    if (advice === 'raise_plan') {
      const overage = p.projected - p.monthlyBudget;
      const gain = overage * s.totals.roas * config.scaleEfficiency;
      recs.push({
        id: `raise_budget:${s.campaign.id}`,
        type: 'raise_budget',
        priority: priorityFor(gain, s.quality.confidence),
        ...texts(
          msg('recMsg.raiseMonthly.title', { name: s.campaign.name, amount: money(overage) }),
          msg('recMsg.raiseMonthly.rationale', { pct: pct(p.pacing - 1), roas: `${s.totals.roas.toFixed(1)}x` }),
        ),
        impact: impact('revenue', gain, msg('recMsg.label.revenueKept')),
        ...basis(s),
        campaignIds: [s.campaign.id],
        creativeIds: [],
        channels: [s.campaign.channel],
      });
    } else if (advice === 'reduce') {
      const overage = p.projected - p.monthlyBudget;
      recs.push({
        id: `lower_budget:${s.campaign.id}`,
        type: 'lower_budget',
        priority: priorityFor(overage, s.quality.confidence),
        ...texts(
          msg('recMsg.lower.title', { name: s.campaign.name, amount: money(p.recommendedDaily) }),
          msg('recMsg.lower.ladder', { amount: money(overage), pct: s.ratio === null ? '-' : pct(s.ratio) }),
        ),
        impact: impact('savings', overage, msg('recMsg.label.overspend')),
        ...basis(s),
        campaignIds: [s.campaign.id],
        creativeIds: [],
        channels: [s.campaign.channel],
      });
    } else if (advice === 'increase') {
      const headroom = p.monthlyBudget - p.projected;
      const gain = headroom * s.totals.roas * config.scaleEfficiency;
      recs.push({
        id: `raise_budget:${s.campaign.id}`,
        type: 'raise_budget',
        priority: priorityFor(gain, s.quality.confidence),
        ...texts(
          msg('recMsg.raiseDaily.title', { name: s.campaign.name, amount: money(p.recommendedDaily) }),
          msg('recMsg.raiseDaily.rationale', { pct: pct(p.pacing), amount: money(headroom) }),
        ),
        impact: impact('revenue', gain, msg('recMsg.label.extraRevenue')),
        ...basis(s),
        campaignIds: [s.campaign.id],
        creativeIds: [],
        channels: [s.campaign.channel],
      });
    }
  }

  // --- Relaunch paused winners --------------------------------------------------
  // Only with enough data (>= minActiveDays of delivery and >= minConversions), and with a
  // warning + halved estimate when the name suggests a promotion that may have ended.
  const lookback = rangeEnding(asOf, config.relaunchLookbackDays);
  for (const s of summarizeCampaigns(campaigns, campaignDaily, lookback, targets, cfg)) {
    if (s.campaign.status !== 'PAUSED' || s.kind !== 'sales') continue;
    if (s.totals.spend < minSpend || !s.quality.sufficient || s.verdict !== 'scale') continue;
    const seasonal = looksSeasonal(s.campaign.name);
    const confidence: Confidence = seasonal ? 'low' : s.quality.confidence;
    const dailySpend = s.totals.spend / s.quality.activeDays;
    const monthly = (s.totals.revenue / s.quality.activeDays) * DAYS_PER_MONTH * config.scaleEfficiency * (seasonal ? 0.5 : 1);
    recs.push({
      id: `relaunch_campaign:${s.campaign.id}`,
      type: 'relaunch_campaign',
      priority: priorityFor(monthly, confidence),
      ...texts(
        msg('recMsg.relaunch.title', { name: s.campaign.name, roas: `${s.totals.roas.toFixed(2)}x` }),
        msg('recMsg.relaunch.rationale', {
          days: s.quality.activeDays,
          spend: money(s.totals.spend),
          roas: `${s.totals.roas.toFixed(2)}x`,
          goal: `${s.target.targetRoas.toFixed(1)}x`,
          cpa: money(s.totals.cpa),
          daily: money(dailySpend),
        }),
      ),
      warningMsg: seasonal ? msg('recMsg.relaunch.seasonal') : undefined,
      impact: impact('revenue', monthly, msg(seasonal ? 'recMsg.label.relaunchSeasonal' : 'recMsg.label.relaunch')),
      confidence,
      window: { ...s.range, activeDays: s.quality.activeDays },
      campaignIds: [s.campaign.id],
      creativeIds: [],
      channels: [s.campaign.channel],
    });
  }

  // --- Creatives: poor performers and fatigue ----------------------------------
  const creativeRows = groupBy<CreativeDailyMetric>(creativeDaily, (r) => r.creativeId);
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const creativeWindow = rangeEnding(asOf, 14);
  for (const cr of creatives) {
    const camp = campaignById.get(cr.campaignId);
    if (!camp || camp.status === 'PAUSED') continue;
    const rows = creativeRows[cr.id] ?? [];
    const target = targetFor(targets, camp.accountId);
    // "Poor" is a CPA judgement: only for campaigns bought for conversions (never awareness/traffic).
    const judgeOnCpa = camp.objective === 'SALES' || camp.objective === 'LEADS';
    const f = detectFatigue(rows, asOf, undefined, judgeOnCpa ? target : undefined);
    if (f.status !== 'fatigued' && f.status !== 'poor') continue;
    const last7 = rows.filter((r) => r.date > rangeEnding(asOf, 8).start);
    const activeDays = new Set(rows.filter((r) => r.spend >= 1 && r.date >= creativeWindow.start).map((r) => r.date)).size;
    const confidence: Confidence = activeDays >= 14 ? 'high' : activeDays >= 7 ? 'medium' : 'low';
    const window = { ...creativeWindow, activeDays };
    if (f.status === 'poor') {
      const spend7 = last7.reduce((sum, r) => sum + r.spend, 0);
      const revenue7 = last7.reduce((sum, r) => sum + r.revenue, 0);
      const saved = Math.max(0, ((spend7 - revenue7) / 7) * DAYS_PER_MONTH);
      recs.push({
        id: `refresh_creative:${cr.id}`,
        type: 'refresh_creative',
        priority: priorityFor(saved, confidence),
        ...texts(
          msg('recMsg.creativePoor.title', { name: cr.name }),
          msg('recMsg.creativePoor.rationale', {
            cpa: f.recentCpa > 0 ? money(f.recentCpa) : '-',
            goal: money(target.targetCpa),
            campaign: camp.name,
          }),
        ),
        impact: impact('savings', saved, msg('recMsg.label.wasted')),
        confidence,
        window,
        campaignIds: [cr.campaignId],
        creativeIds: [cr.id],
        channels: [cr.channel],
      });
      continue;
    }
    const revenue7 = last7.reduce((sum, r) => sum + r.revenue, 0);
    const drop = Math.max(Math.abs(Math.min(0, f.ctrChange)), Math.abs(Math.min(0, f.hookChange ?? 0)), Math.max(0, f.cpaChange));
    const recovered = (revenue7 / 7) * DAYS_PER_MONTH * Math.min(0.5, drop);
    recs.push({
      id: `refresh_creative:${cr.id}`,
      type: 'refresh_creative',
      priority: priorityFor(recovered, confidence),
      ...texts(
        msg('recMsg.creative.title', { name: cr.name }),
        msg('recMsg.creative.rationale', {
          freq: `+${Math.round(f.frequencyChange * 100)}%`,
          ctr: `${Math.round(f.ctrChange * 100)}%`,
          campaign: camp.name,
        }),
      ),
      impact: impact('revenue', recovered, msg('recMsg.label.recovered')),
      confidence,
      window,
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
