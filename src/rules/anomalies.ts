import type { Campaign, CampaignDailyMetric, Channel, ISODate } from '../data/types';
import { addDays } from '../lib/dates';
import { safeDiv } from '../lib/metrics';

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type AnomalyType = 'cpa_spike' | 'roas_drop' | 'spend_stopped' | 'high_frequency';

export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: Severity;
  campaignId: string;
  campaignName: string;
  channel: Channel;
  date: ISODate;
  title: string;
  detail: string;
  current: number;
  baseline: number;
}

export interface AnomalyConfig {
  /** CPA day-over-day increase that triggers an alert (0.3 = +30%). */
  cpaSpikePct: number;
  /** Recent-vs-baseline ROAS decrease that triggers an alert. */
  roasDropPct: number;
  roasRecentDays: number;
  roasBaselineDays: number;
  frequencyMax: number;
  /** Ignore CPA swings when the comparison day had fewer conversions than this. */
  minConversions: number;
  /** Minimum daily spend for a day to count as "spending". */
  minSpend: number;
  /** How many days back CPA spikes are reported. */
  lookbackDays: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  cpaSpikePct: 0.3,
  roasDropPct: 0.25,
  roasRecentDays: 3,
  roasBaselineDays: 14,
  frequencyMax: 4,
  minConversions: 5,
  minSpend: 50,
  lookbackDays: 7,
};

export interface AnomalyInput {
  campaigns: readonly Campaign[];
  campaignDaily: readonly CampaignDailyMetric[];
  asOf: ISODate;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

type DayRow = Pick<CampaignDailyMetric, 'spend' | 'revenue' | 'conversions' | 'frequency' | 'impressions'>;
const EMPTY: DayRow = { spend: 0, revenue: 0, conversions: 0, frequency: 0, impressions: 0 };

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
  for (const c of campaigns) {
    if (c.status === 'PAUSED') continue;
    const days = byCampaign.get(c.id) ?? new Map<string, DayRow>();
    const base = { campaignId: c.id, campaignName: c.name, channel: c.channel };

    // 1. CPA spike, day over day
    for (let i = 0; i < config.lookbackDays; i++) {
      const date = addDays(asOf, -i);
      const today = days.get(date);
      const prev = days.get(addDays(date, -1));
      if (!today || !prev) continue;
      if (today.spend < config.minSpend || prev.conversions < config.minConversions) continue;
      const prevCpa = prev.spend / prev.conversions;
      const cpa = today.conversions > 0 ? today.spend / today.conversions : Infinity;
      const change = cpa / prevCpa - 1;
      if (change > config.cpaSpikePct) {
        const finite = Number.isFinite(cpa);
        out.push({
          ...base,
          id: `cpa_spike:${c.id}:${date}`,
          type: 'cpa_spike',
          severity: !finite || change >= 0.6 ? 'high' : 'medium',
          date,
          title: finite ? `CPA spiked ${pct(change)} day over day` : 'Spend with zero conversions',
          detail: finite
            ? `CPA went from $${prevCpa.toFixed(2)} to $${cpa.toFixed(2)} on ${date}.`
            : `$${today.spend.toFixed(0)} spent on ${date} without a conversion.`,
          current: finite ? cpa : today.spend,
          baseline: prevCpa,
        });
      }
    }

    // 2. ROAS drop, recent window vs baseline window
    const recent = sumWindow(days, asOf, config.roasRecentDays);
    const baseline = sumWindow(days, addDays(asOf, -config.roasRecentDays), config.roasBaselineDays);
    if (recent.spend >= config.minSpend * config.roasRecentDays && baseline.roas > 0) {
      const drop = 1 - recent.roas / baseline.roas;
      if (drop > config.roasDropPct) {
        out.push({
          ...base,
          id: `roas_drop:${c.id}:${asOf}`,
          type: 'roas_drop',
          severity: drop >= 0.4 ? 'high' : 'medium',
          date: asOf,
          title: `ROAS down ${pct(drop)}`,
          detail: `Last ${config.roasRecentDays} days ROAS ${recent.roas.toFixed(2)}x vs ${baseline.roas.toFixed(2)}x over the prior ${config.roasBaselineDays} days.`,
          current: recent.roas,
          baseline: baseline.roas,
        });
      }
    }

    // 3. Spend stopped
    const spendOn = (d: ISODate) => (days.get(d) ?? EMPTY).spend;
    if (spendOn(asOf) < 1) {
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
          title: streak === 1 ? 'Spend stopped yesterday' : `No spend for ${streak} days`,
          detail: `Campaign is ${c.status.toLowerCase()} but delivered $0 since ${addDays(asOf, -(streak - 1))} (was ~$${avgBefore.toFixed(0)}/day). Check billing, approvals and schedule.`,
          current: 0,
          baseline: avgBefore,
        });
      }
    }

    // 4. Frequency above cap
    const last = days.get(asOf);
    if (last && last.impressions > 0 && last.frequency > config.frequencyMax) {
      out.push({
        ...base,
        id: `high_frequency:${c.id}:${asOf}`,
        type: 'high_frequency',
        severity: last.frequency > config.frequencyMax * 1.25 ? 'high' : 'medium',
        date: asOf,
        title: `Frequency at ${last.frequency.toFixed(1)}`,
        detail: `7-day frequency is above the cap of ${config.frequencyMax}. Audience saturation risk - expect rising CPMs and falling CTR.`,
        current: last.frequency,
        baseline: config.frequencyMax,
      });
    }
  }

  return out.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.date.localeCompare(a.date) ||
      a.campaignName.localeCompare(b.campaignName),
  );
}
