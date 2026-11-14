import { describe, expect, it } from 'vitest';
import type { Campaign, CampaignDailyMetric, Creative, CreativeDailyMetric } from '../data/types';
import { addDays } from '../lib/dates';
import { detectAnomalies } from './anomalies';
import { detectFatigue } from './fatigue';
import { campaignHealth } from './health';
import { computePacing } from './pacing';
import { generateRecommendations } from './recommendations';
import { generateDataset } from '../data/mock';
import { DEFAULT_TARGETS } from './targets';
import { DICTS } from '../i18n/dict';

const AS_OF = '2026-03-20';

function campaign(id: string, over: Partial<Campaign> = {}): Campaign {
  return {
    id,
    accountId: 'acc',
    channel: 'meta',
    name: `Campaign ${id}`,
    objective: 'SALES',
    status: 'ACTIVE',
    dailyBudget: 100,
    monthlyBudget: 3100,
    startDate: '2025-01-01',
    ...over,
  };
}

/** `days` rows ending at AS_OF; `fn(k)` returns overrides for k days before AS_OF. */
function series(
  campaignId: string,
  days: number,
  fn: (k: number) => Partial<CampaignDailyMetric> | null = () => ({}),
): CampaignDailyMetric[] {
  const rows: CampaignDailyMetric[] = [];
  for (let k = days - 1; k >= 0; k--) {
    const o = fn(k);
    if (o === null) continue;
    rows.push({
      date: addDays(AS_OF, -k),
      campaignId,
      spend: 100,
      impressions: 10_000,
      reach: 5_000,
      clicks: 150,
      conversions: 10,
      revenue: 300,
      frequency: 2,
      ...o,
    });
  }
  return rows;
}

describe('detectAnomalies', () => {
  it('flags a CPA spike above 30% day over day', () => {
    const daily = series('a', 21, (k) => (k === 0 ? { conversions: 6, revenue: 180 } : {}));
    const out = detectAnomalies({ campaigns: [campaign('a')], campaignDaily: daily, asOf: AS_OF });
    const spike = out.find((a) => a.type === 'cpa_spike');
    expect(spike).toBeDefined();
    expect(spike!.date).toBe(AS_OF);
    expect(spike!.severity).toBe('high'); // CPA 10 -> 16.67 = +67%
  });

  it('ignores a 20% CPA move and stable campaigns', () => {
    const daily = series('a', 21, (k) => (k === 0 ? { conversions: 8.4 } : {}));
    const out = detectAnomalies({ campaigns: [campaign('a')], campaignDaily: daily, asOf: AS_OF });
    expect(out).toEqual([]);
  });

  it('flags a ROAS drop, stopped spend and high frequency', () => {
    const campaigns = [campaign('drop'), campaign('stop'), campaign('freq'), campaign('paused', { status: 'PAUSED' })];
    const daily = [
      ...series('drop', 21, (k) => (k < 3 ? { revenue: 150 } : {})),
      ...series('stop', 21, (k) => (k < 2 ? null : {})),
      ...series('freq', 21, (k) => (k === 0 ? { frequency: 5.6 } : {})),
      ...series('paused', 21, (k) => (k < 5 ? null : {})),
    ];
    const out = detectAnomalies({ campaigns, campaignDaily: daily, asOf: AS_OF });
    const types = out.map((a) => `${a.type}:${a.campaignId}`);
    expect(types).toContain('roas_drop:drop');
    expect(types).toContain('spend_stopped:stop');
    expect(types).toContain('high_frequency:freq');
    expect(types.some((t) => t.endsWith(':paused'))).toBe(false);
    // critical first
    expect(out[0].type).toBe('spend_stopped');
    expect(out[0].title).toBe('No spend for 2 days');
  });
});

describe('detectFatigue', () => {
  const rows = (fatigued: boolean): CreativeDailyMetric[] =>
    Array.from({ length: 14 }, (_, i) => {
      const recent = i >= 7;
      return {
        date: addDays(AS_OF, i - 13),
        creativeId: 'c',
        campaignId: 'a',
        spend: 50,
        impressions: 5000,
        clicks: fatigued && recent ? 50 : 75,
        conversions: 3,
        revenue: 150,
        videoViews3s: 1500,
        frequency: fatigued && recent ? 3.2 : 2,
      };
    });

  it('marks rising frequency + falling CTR as fatigued', () => {
    const f = detectFatigue(rows(true), AS_OF);
    expect(f.status).toBe('fatigued');
    expect(f.frequencyChange).toBeCloseTo(0.6);
    expect(f.ctrChange).toBeCloseTo(-1 / 3);
  });

  it('keeps steady creatives healthy', () => {
    expect(detectFatigue(rows(false), AS_OF).status).toBe('healthy');
  });
});

describe('computePacing & health', () => {
  it('projects end-of-month spend and flags over-pacing', () => {
    // 20 days elapsed in March at $150/day vs a $3,100 plan
    const daily = series('a', 20, () => ({ spend: 150 }));
    const p = computePacing(campaign('a'), daily, AS_OF);
    expect(p.mtdSpend).toBe(3000);
    expect(p.daysRemaining).toBe(11);
    expect(p.projected).toBe(3000 + 150 * 11);
    expect(p.status).toBe('over');
    expect(p.recommendedDaily).toBeCloseTo(100 / 11);
  });

  it('scores health against goals', () => {
    const target = { targetCpa: 30, targetRoas: 3 };
    expect(campaignHealth({ spend: 100, roas: 3.5, cpa: 25, conversions: 4 }, target)).toBe('good');
    expect(campaignHealth({ spend: 100, roas: 2.6, cpa: 25, conversions: 4 }, target)).toBe('warning');
    expect(campaignHealth({ spend: 100, roas: 1.0, cpa: 90, conversions: 1 }, target)).toBe('critical');
    expect(campaignHealth({ spend: 0, roas: 0, cpa: 0, conversions: 0 }, target)).toBe('inactive');
  });
});

describe('generateRecommendations', () => {
  const creatives: Creative[] = [];

  it('shifts budget from a loser to a winner with an estimated impact', () => {
    const campaigns = [campaign('x', { name: 'Loser' }), campaign('y', { name: 'Winner' })];
    const daily = [
      ...series('x', 30, () => ({ revenue: 80, conversions: 1 })), // ROAS 0.8
      ...series('y', 30, () => ({ revenue: 340, conversions: 12 })), // ROAS 3.4
    ];
    const recs = generateRecommendations({
      campaigns,
      campaignDaily: daily,
      creatives,
      creativeDaily: [],
      asOf: AS_OF,
      targets: { acc: { targetCpa: 40, targetRoas: 2.5 } },
    });
    const shift = recs.find((r) => r.type === 'shift_budget');
    expect(shift?.title).toBe('Shift 15% budget from Loser (ROAS 0.8) to Winner (ROAS 3.4)');
    // $15/day * 30 * (3.4 * 0.7 - 0.8)
    expect(shift?.impact.monthly).toBeCloseTo(15 * 30 * (3.4 * 0.7 - 0.8));
  });

  it('is deterministic on the seeded mock dataset and covers the key rule types', () => {
    const data = generateDataset('2026-11-13');
    const input = { ...data, targets: DEFAULT_TARGETS };
    const a = generateRecommendations(input);
    const b = generateRecommendations(input);
    expect(a).toEqual(b);
    const types = new Set(a.map((r) => r.type));
    for (const t of ['shift_budget', 'pause_campaign', 'refresh_creative', 'fix_delivery', 'expand_audience']) {
      expect(types.has(t as never)).toBe(true);
    }
    const anomalyTypes = new Set(detectAnomalies(data).map((x) => x.type));
    expect([...anomalyTypes].sort()).toEqual(['cpa_spike', 'high_frequency', 'roas_drop', 'spend_stopped']);
  });
});

describe('pacing without a monthly budget', () => {
  it('skips pacing recommendations for campaigns with no monthly plan (Meta has none)', () => {
    const c = campaign('nobudget', { monthlyBudget: 0 });
    const rows = series('nobudget', 30, () => ({ spend: 50, revenue: 400, conversions: 10 }));
    const recs = generateRecommendations({
      campaigns: [c],
      campaignDaily: rows,
      creatives: [],
      creativeDaily: [],
      asOf: AS_OF,
      targets: { acc: { targetCpa: 40, targetRoas: 2.5 } },
    });
    expect(recs.filter((r) => r.type === 'raise_budget' || r.type === 'lower_budget')).toEqual([]);
  });
});

describe('translatable rule texts', () => {
  it('fills every placeholder in English and Arabic for all generated alerts and recommendations', () => {
    const data = generateDataset('2026-11-13');
    const input = { ...data, targets: DEFAULT_TARGETS };
    const msgs = [
      ...detectAnomalies(data).flatMap((a) => [a.titleMsg, a.detailMsg]),
      ...generateRecommendations(input).flatMap((r) => [r.titleMsg, r.rationaleMsg, r.impact.labelMsg]),
    ];
    expect(msgs.length).toBeGreaterThan(10);
    for (const m of msgs) {
      for (const lang of ['en', 'ar'] as const) {
        let s: string = DICTS[lang][m.key];
        for (const [k, v] of Object.entries(m.vars)) s = s.split(`{${k}}`).join(String(v));
        expect(s, `${lang}:${m.key}`).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
