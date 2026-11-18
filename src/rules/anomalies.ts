import type { Campaign, CampaignDailyMetric, Channel, ISODate } from '../data/types';
import { addDays } from '../lib/dates';
import { aggregate, safeDiv } from '../lib/metrics';
import { audienceType, campaignKind } from './evaluate';
import { fmtMoney, fmtMoney2 } from '../lib/format';
import { msg, renderEn, type Msg } from './msg';

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type AnomalyType = 'cpa_spike' | 'roas_drop' | 'spend_stopped' | 'high_frequency' | 'account_stopped';

export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: Severity;
  campaignId: string;
  campaignName: string;
  channel: Channel;
  date: ISODate;
  /** English text; the UI renders the translatable `titleMsg` / `detailMsg` instead. */
  title: string;
  detail: string;
  titleMsg: Msg;
  detailMsg: Msg;
  current: number;
  baseline: number;
}

export interface AnomalyConfig {
  /** CPA increase (recent window vs baseline window) that triggers an alert (0.3 = +30%). */
  cpaSpikePct: number;
  /** CPA: last N days... */
  cpaRecentDays: number;
  /** ...vs the M days before them. Day-over-day CPA is noise. */
  cpaBaselineDays: number;
  /** Recent-vs-baseline ROAS decrease that triggers an alert. */
  roasDropPct: number;
  roasRecentDays: number;
  roasBaselineDays: number;
  /** Frequency caps by audience type (see evaluate.ts). */
  freqCapProspecting: number;
  freqCapRetargeting: number;
  /** Both CPA windows need at least this many conversions. */
  minConversions: number;
  /** Minimum daily spend for a day to count as "spending". */
  minSpend: number;
  /** Rules switched off by the user. */
  disabled?: AnomalyType[];
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  cpaSpikePct: 0.3,
  cpaRecentDays: 3,
  cpaBaselineDays: 11,
  roasDropPct: 0.25,
  roasRecentDays: 3,
  roasBaselineDays: 14,
  freqCapProspecting: 3.5,
  freqCapRetargeting: 7,
  minConversions: 10,
  minSpend: 50,
};

export interface AnomalyInput {
  campaigns: readonly Campaign[];
  campaignDaily: readonly CampaignDailyMetric[];
  asOf: ISODate;
  /** Account display names for account-level alerts (falls back to the account id). */
  accountNames?: Record<string, string>;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

type DayRow = Pick<CampaignDailyMetric, 'spend' | 'revenue' | 'conversions' | 'frequency' | 'impressions'>;
const EMPTY: DayRow = { spend: 0, revenue: 0, conversions: 0, frequency: 0, impressions: 0 };

function sumWindowFull(byDate: Map<string, DayRow>, end: ISODate, days: number) {
  let spend = 0;
  let conversions = 0;
  for (let i = 0; i < days; i++) {
    const r = byDate.get(addDays(end, -i)) ?? EMPTY;
    spend += r.spend;
    conversions += r.conversions;
  }
  return { spend, conversions };
}

function sumWindow(byDate: Map<string, DayRow>, end: ISODate, days: number) {
  let spend = 0;
  let revenue = 0;
  for (let i = 0; i < days; i++) {
    const r = byDate.get(addDays(end, -i)) ?? EMPTY;
    spend += r.spend;
    revenue += r.revenue;
  }
  return { spend, revenue, roas: safeDiv(revenue, spend) };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

const texts = (titleMsg: Msg, detailMsg: Msg) => ({
  titleMsg,
  detailMsg,
  title: renderEn(titleMsg),
  detail: renderEn(detailMsg),
});

/**
 * Rule-based anomaly detection over daily campaign insights.
 *
 * - CPA spike: CPA up more than `cpaSpikePct` vs the previous day (scanned over `lookbackDays`).
 * - ROAS drop: last `roasRecentDays` ROAS down more than `roasDropPct` vs the `roasBaselineDays` before.
 * - Spend stopped: a non-paused campaign with no spend on `asOf` that was spending before.
 * - High frequency: latest frequency above `frequencyMax`.
 *
 * Missing rows are treated as zero-delivery days (that is how platform APIs report them).
 */
export function detectAnomalies(input: AnomalyInput, config: AnomalyConfig = DEFAULT_ANOMALY_CONFIG): Anomaly[] {
  const { campaigns, campaignDaily, asOf } = input;
  const byCampaign = new Map<string, Map<string, DayRow>>();
  for (const r of campaignDaily) {
    let m = byCampaign.get(r.campaignId);
    if (!m) byCampaign.set(r.campaignId, (m = new Map()));
    m.set(r.date, r);
  }

  const out: Anomaly[] = [];
  const on = (t: AnomalyType) => !config.disabled?.includes(t);
  for (const c of campaigns) {
    if (c.status === 'PAUSED') continue;
    const days = byCampaign.get(c.id) ?? new Map<string, DayRow>();
    const base = { campaignId: c.id, campaignName: c.name, channel: c.channel };

    // 1. CPA spike: last `cpaRecentDays` vs the `cpaBaselineDays` before (sales / leads only).
    const kind = campaignKind(c, aggregate([...days.values()] as never[]));
    const recentW = sumWindowFull(days, asOf, config.cpaRecentDays);
    const baseW = sumWindowFull(days, addDays(asOf, -config.cpaRecentDays), config.cpaBaselineDays);
    if (
      on('cpa_spike') &&
      (kind === 'sales' || kind === 'leads') &&
      recentW.conversions >= config.minConversions &&
      baseW.conversions >= config.minConversions &&
      recentW.spend >= config.minSpend * config.cpaRecentDays
    ) {
      const cpa = recentW.spend / recentW.conversions;
      const baseCpa = baseW.spend / baseW.conversions;
      const change = cpa / baseCpa - 1;
      if (change > config.cpaSpikePct) {
        out.push({
          ...base,
          id: `cpa_spike:${c.id}:${asOf}`,
          type: 'cpa_spike',
          severity: change >= 0.6 ? 'high' : 'medium',
          date: asOf,
          ...texts(
            msg('anomalyMsg.cpaSpike.titleWindow', { pct: pct(change), base: config.cpaBaselineDays }),
            msg('anomalyMsg.cpaSpike.window', {
              from: fmtMoney2(baseCpa),
              to: fmtMoney2(cpa),
              recent: config.cpaRecentDays,
              base: config.cpaBaselineDays,
              conv: recentW.conversions,
            }),
          ),
          current: cpa,
          baseline: baseCpa,
        });
      }
    }

    // 2. ROAS drop, recent window vs baseline window
    const recent = sumWindow(days, asOf, config.roasRecentDays);
    const baseline = sumWindow(days, addDays(asOf, -config.roasRecentDays), config.roasBaselineDays);
    if (on('roas_drop') && kind === 'sales' && recent.spend >= config.minSpend * config.roasRecentDays && baseline.roas > 0) {
      const drop = 1 - recent.roas / baseline.roas;
      if (drop > config.roasDropPct) {
        out.push({
          ...base,
          id: `roas_drop:${c.id}:${asOf}`,
          type: 'roas_drop',
          severity: drop >= 0.4 ? 'high' : 'medium',
          date: asOf,
          ...texts(
            msg('anomalyMsg.roasDrop.title', { pct: pct(drop) }),
            msg('anomalyMsg.roasDrop.detail', {
              recentDays: config.roasRecentDays,
              recent: `${recent.roas.toFixed(2)}x`,
              baseline: `${baseline.roas.toFixed(2)}x`,
              baseDays: config.roasBaselineDays,
            }),
          ),
          current: recent.roas,
          baseline: baseline.roas,
        });
      }
    }

    // 3. Spend stopped
    const spendOn = (d: ISODate) => (days.get(d) ?? EMPTY).spend;
    if (on('spend_stopped') && spendOn(asOf) < 1) {
      let streak = 0;
      while (streak < 30 && spendOn(addDays(asOf, -streak)) < 1) streak++;
      const before = sumWindow(days, addDays(asOf, -streak), 7);
      const avgBefore = before.spend / 7;
      if (streak < 30 && avgBefore >= config.minSpend) {
        out.push({
          ...base,
          id: `spend_stopped:${c.id}:${asOf}`,
          type: 'spend_stopped',
          severity: 'critical',
          date: asOf,
          ...texts(
            streak === 1 ? msg('anomalyMsg.stopped.titleOne') : msg('anomalyMsg.stopped.title', { n: streak }),
            msg('anomalyMsg.stopped.detail', {
              status: c.status.toLowerCase(),
              zero: fmtMoney(0),
              since: addDays(asOf, -(streak - 1)),
              avg: fmtMoney(avgBefore),
            }),
          ),
          current: 0,
          baseline: avgBefore,
        });
      }
    }

    // 4. Frequency above cap
    const last = days.get(asOf);
    const cap = audienceType(c) === 'retargeting' ? config.freqCapRetargeting : config.freqCapProspecting;
    if (on('high_frequency') && last && last.impressions > 0 && last.frequency > cap) {
      out.push({
        ...base,
        id: `high_frequency:${c.id}:${asOf}`,
        type: 'high_frequency',
        severity: last.frequency > cap * 1.25 ? 'high' : 'medium',
        date: asOf,
        ...texts(
          msg('anomalyMsg.freq.title', { freq: last.frequency.toFixed(1) }),
          msg(audienceType(c) === 'retargeting' ? 'anomalyMsg.freq.detailRtg' : 'anomalyMsg.freq.detail', { max: cap }),
        ),
        current: last.frequency,
        baseline: cap,
      });
    }
  }

  // 5. Whole account stopped spending. The per-campaign rule skips paused campaigns, so an
  // account where someone paused everything would otherwise produce no alert at all.
  const campaignsByAccount = new Map<string, Campaign[]>();
  for (const c of campaigns) {
    const list = campaignsByAccount.get(c.accountId) ?? [];
    list.push(c);
    campaignsByAccount.set(c.accountId, list);
  }
  for (const [accountId, list] of campaignsByAccount) {
    const ids = new Set(list.map((c) => c.id));
    const spendByDate = new Map<string, number>();
    for (const r of campaignDaily) if (ids.has(r.campaignId)) spendByDate.set(r.date, (spendByDate.get(r.date) ?? 0) + r.spend);
    const spendOn = (d: ISODate) => spendByDate.get(d) ?? 0;
    if (!on('account_stopped') || spendOn(asOf) >= 1) continue;
    let streak = 0;
    while (streak < 30 && spendOn(addDays(asOf, -streak)) < 1) streak++;
    if (streak >= 30) continue;
    const lastSpendDay = addDays(asOf, -streak);
    let before = 0;
    for (let i = 0; i < 7; i++) before += spendOn(addDays(lastSpendDay, -i));
    const avgBefore = before / 7;
    if (avgBefore < config.minSpend) continue;
    const name = input.accountNames?.[accountId] ?? accountId;
    out.push({
      id: `account_stopped:${accountId}:${asOf}`,
      type: 'account_stopped',
      severity: 'critical',
      campaignId: '',
      campaignName: name,
      channel: list[0].channel,
      date: asOf,
      ...texts(
        streak === 1 ? msg('anomalyMsg.account.titleOne', { name }) : msg('anomalyMsg.account.title', { name, n: streak }),
        msg('anomalyMsg.account.detail', {
          since: addDays(lastSpendDay, 1),
          avg: fmtMoney(avgBefore),
          paused: list.filter((c) => c.status === 'PAUSED').length,
          total: list.length,
        }),
      ),
      current: 0,
      baseline: avgBefore,
    });
  }

  return out.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.date.localeCompare(a.date) ||
      a.campaignName.localeCompare(b.campaignName),
  );
}
