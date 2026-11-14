/**
 * Seeded, deterministic mock data generator.
 *
 * Produces ~190 days of daily campaign and creative insights for three ad
 * accounts (Meta, Google Ads, TikTok). Each campaign has a "profile" plus an
 * optional scenario that injects a realistic problem (CPA spike, ROAS drop,
 * delivery stopped, creative fatigue...) so the rules engines have something
 * to find. Values for a given campaign + calendar date are stable across reloads.
 */
import type {
  AdAccount,
  Campaign,
  CampaignDailyMetric,
  CampaignStatus,
  Channel,
  Creative,
  CreativeDailyMetric,
  CreativeFormat,
  Dataset,
  ISODate,
  Objective,
} from './types';
import { addDays, parseISO } from '../lib/dates';

// ---------------------------------------------------------------- RNG ----

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(...parts: string[]): (lo: number, hi: number) => number {
  const r = mulberry32(hashString(parts.join('|')));
  return (lo, hi) => lo + (hi - lo) * r();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ----------------------------------------------------------- Accounts ----

export const ACCOUNTS: AdAccount[] = [
  { id: 'act_1048203311', name: 'Lumen Store - Meta', channel: 'meta', currency: 'USD', timezone: 'America/New_York' },
  { id: '482-913-2207', name: 'Lumen Store - Google Ads', channel: 'google', currency: 'USD', timezone: 'America/New_York' },
  { id: '7190345528810', name: 'Lumen Store - TikTok', channel: 'tiktok', currency: 'USD', timezone: 'America/New_York' },
];

const accountFor = (c: Channel) => ACCOUNTS.find((a) => a.channel === c)!.id;

// ---------------------------------------------------------- Campaigns ----

type Scenario = 'cpaSpike' | 'roasDrop' | 'spendStopped' | 'fatigue' | 'pausedRecently' | 'learning' | 'freqCreep';

interface CampaignProfile {
  id: string;
  channel: Channel;
  name: string;
  objective: Objective;
  status: CampaignStatus;
  dailyBudget: number;
  /** spend as a share of daily budget */
  pace: number;
  /** monthly plan vs dailyBudget * 30.4 */
  plan: number;
  roas: number;
  aov: number;
  ctr: number;
  cpm: number;
  freq: [number, number];
  /** days before asOf that the campaign launched */
  ageDays: number;
  scenario?: Scenario;
}

const PROFILES: CampaignProfile[] = [
  // Meta
  { id: 'm-01', channel: 'meta', name: 'Prospecting | Broad | Advantage+', objective: 'SALES', status: 'ACTIVE', dailyBudget: 1200, pace: 1.02, plan: 0.9, roas: 3.4, aov: 86, ctr: 0.0142, cpm: 14.5, freq: [1.6, 1.9], ageDays: 200 },
  { id: 'm-02', channel: 'meta', name: 'Prospecting | LAL 1% Purchasers', objective: 'SALES', status: 'ACTIVE', dailyBudget: 650, pace: 0.97, plan: 1.0, roas: 0.8, aov: 82, ctr: 0.0098, cpm: 17.8, freq: [1.8, 2.2], ageDays: 160 },
  { id: 'm-03', channel: 'meta', name: 'Retargeting | DPA 7d Viewers', objective: 'SALES', status: 'ACTIVE', dailyBudget: 380, pace: 0.99, plan: 1.0, roas: 4.6, aov: 74, ctr: 0.0186, cpm: 22.0, freq: [3.6, 5.2], ageDays: 300, scenario: 'freqCreep' },
  { id: 'm-04', channel: 'meta', name: 'Spring Sale | Advantage+ Shopping', objective: 'SALES', status: 'PAUSED', dailyBudget: 900, pace: 1.0, plan: 0.35, roas: 2.7, aov: 79, ctr: 0.0131, cpm: 15.9, freq: [1.7, 2.4], ageDays: 110, scenario: 'pausedRecently' },
  // Google
  { id: 'g-01', channel: 'google', name: 'Search | Brand | Exact', objective: 'SALES', status: 'ACTIVE', dailyBudget: 450, pace: 1.0, plan: 0.82, roas: 7.2, aov: 91, ctr: 0.112, cpm: 98.0, freq: [1.2, 1.3], ageDays: 400 },
  { id: 'g-02', channel: 'google', name: 'Search | Non-brand | Generic', objective: 'SALES', status: 'ACTIVE', dailyBudget: 800, pace: 0.66, plan: 1.0, roas: 2.1, aov: 88, ctr: 0.047, cpm: 61.0, freq: [1.1, 1.2], ageDays: 260 },
  { id: 'g-03', channel: 'google', name: 'PMax | All Products', objective: 'SALES', status: 'ACTIVE', dailyBudget: 1000, pace: 1.06, plan: 0.95, roas: 3.0, aov: 84, ctr: 0.0118, cpm: 11.4, freq: [1.9, 2.3], ageDays: 220, scenario: 'cpaSpike' },
  { id: 'g-04', channel: 'google', name: 'YouTube | Awareness | In-stream', objective: 'AWARENESS', status: 'ACTIVE', dailyBudget: 500, pace: 0.98, plan: 1.0, roas: 0.55, aov: 80, ctr: 0.0041, cpm: 9.2, freq: [2.1, 2.6], ageDays: 140 },
  // TikTok
  { id: 't-01', channel: 'tiktok', name: 'Spark Ads | UGC Creators', objective: 'SALES', status: 'ACTIVE', dailyBudget: 700, pace: 1.0, plan: 1.0, roas: 2.6, aov: 68, ctr: 0.0112, cpm: 8.4, freq: [1.7, 1.9], ageDays: 150, scenario: 'fatigue' },
  { id: 't-02', channel: 'tiktok', name: 'Prospecting | Interest Stack', objective: 'SALES', status: 'ACTIVE', dailyBudget: 550, pace: 0.96, plan: 1.0, roas: 2.4, aov: 66, ctr: 0.0094, cpm: 7.6, freq: [1.5, 1.8], ageDays: 180, scenario: 'roasDrop' },
  { id: 't-03', channel: 'tiktok', name: 'TopView | Q4 Launch', objective: 'AWARENESS', status: 'ACTIVE', dailyBudget: 600, pace: 1.0, plan: 1.0, roas: 1.4, aov: 72, ctr: 0.0081, cpm: 10.1, freq: [1.4, 2.0], ageDays: 45, scenario: 'spendStopped' },
  { id: 't-04', channel: 'tiktok', name: 'Smart+ | Catalog Sales', objective: 'SALES', status: 'LEARNING', dailyBudget: 300, pace: 0.9, plan: 1.0, roas: 1.9, aov: 70, ctr: 0.0099, cpm: 8.9, freq: [1.2, 1.4], ageDays: 10, scenario: 'learning' },
];

// ---------------------------------------------------------- Creatives ----

interface CreativeProfile {
  id: string;
  campaignId: string;
  name: string;
  format: CreativeFormat;
  headline: string;
  color: string;
  weight: number;
  ctrFactor: number;
  roasFactor: number;
  /** 3s view rate for video, 0 otherwise */
  hook: number;
  /** creative-specific fatigue in the last ~2 weeks */
  fatigue?: boolean;
}

const CREATIVES: CreativeProfile[] = [
  { id: 'cr-101', campaignId: 'm-01', name: 'UGC Testimonial - Sarah', format: 'video', headline: '"I replaced 3 products with this"', color: '#6366f1', weight: 0.38, ctrFactor: 1.05, roasFactor: 1.0, hook: 0.31, fatigue: true },
  { id: 'cr-102', campaignId: 'm-01', name: 'Founder Story 30s', format: 'video', headline: 'Why we built Lumen', color: '#0ea5e9', weight: 0.27, ctrFactor: 0.92, roasFactor: 1.08, hook: 0.36 },
  { id: 'cr-103', campaignId: 'm-01', name: 'Bundle Offer Static', format: 'image', headline: 'Save 20% on the starter kit', color: '#f59e0b', weight: 0.2, ctrFactor: 1.12, roasFactor: 0.96, hook: 0 },
  { id: 'cr-104', campaignId: 'm-01', name: 'Benefits Carousel', format: 'carousel', headline: '5 reasons customers switch', color: '#10b981', weight: 0.15, ctrFactor: 0.95, roasFactor: 0.94, hook: 0 },
  { id: 'cr-201', campaignId: 'm-02', name: 'Product Demo 15s', format: 'video', headline: 'See it in action', color: '#ef4444', weight: 0.55, ctrFactor: 0.9, roasFactor: 0.9, hook: 0.22 },
  { id: 'cr-202', campaignId: 'm-02', name: 'Lifestyle Static', format: 'image', headline: 'Light up your mornings', color: '#a855f7', weight: 0.45, ctrFactor: 1.08, roasFactor: 1.1, hook: 0 },
  { id: 'cr-301', campaignId: 'm-03', name: 'DPA - Recently Viewed', format: 'carousel', headline: 'Still thinking it over?', color: '#14b8a6', weight: 0.7, ctrFactor: 1.04, roasFactor: 1.04, hook: 0 },
  { id: 'cr-302', campaignId: 'm-03', name: 'Reviews Montage', format: 'video', headline: '4.8 stars from 12k reviews', color: '#f97316', weight: 0.3, ctrFactor: 0.92, roasFactor: 0.92, hook: 0.34 },
  { id: 'cr-401', campaignId: 'm-04', name: 'Spring Sale Hero', format: 'image', headline: 'Spring Sale - 30% off', color: '#84cc16', weight: 1, ctrFactor: 1, roasFactor: 1, hook: 0 },
  { id: 'cr-501', campaignId: 'g-03', name: 'PMax Asset Group - Bestsellers', format: 'image', headline: 'Bestsellers, shipped free', color: '#3b82f6', weight: 0.6, ctrFactor: 1.03, roasFactor: 1.05, hook: 0 },
  { id: 'cr-502', campaignId: 'g-03', name: 'PMax Asset Group - New In', format: 'video', headline: 'New arrivals this week', color: '#ec4899', weight: 0.4, ctrFactor: 0.95, roasFactor: 0.93, hook: 0.27 },
  { id: 'cr-601', campaignId: 'g-04', name: 'Brand Film 30s', format: 'video', headline: 'Lumen - made for better days', color: '#64748b', weight: 0.65, ctrFactor: 0.9, roasFactor: 0.9, hook: 0.41 },
  { id: 'cr-602', campaignId: 'g-04', name: 'Bumper 6s', format: 'video', headline: 'Glow up in 6 seconds', color: '#eab308', weight: 0.35, ctrFactor: 1.15, roasFactor: 1.15, hook: 0.58 },
  { id: 'cr-701', campaignId: 't-01', name: 'Creator @maya - Unboxing', format: 'video', headline: 'POV: you finally found it', color: '#f43f5e', weight: 0.45, ctrFactor: 1.08, roasFactor: 1.04, hook: 0.39, fatigue: true },
  { id: 'cr-702', campaignId: 't-01', name: 'Creator @leo - GRWM', format: 'video', headline: 'Get ready with me (5 min routine)', color: '#8b5cf6', weight: 0.33, ctrFactor: 0.98, roasFactor: 1.0, hook: 0.33 },
  { id: 'cr-703', campaignId: 't-01', name: 'Creator @jules - Before/After', format: 'video', headline: 'Day 1 vs day 30', color: '#06b6d4', weight: 0.22, ctrFactor: 0.9, roasFactor: 0.92, hook: 0.29 },
  { id: 'cr-801', campaignId: 't-02', name: 'Problem/Solution Hook', format: 'video', headline: 'Stop doing this every morning', color: '#22c55e', weight: 0.6, ctrFactor: 1.02, roasFactor: 1.0, hook: 0.35 },
  { id: 'cr-802', campaignId: 't-02', name: 'Green Screen Explainer', format: 'video', headline: 'The science, in 20 seconds', color: '#d946ef', weight: 0.4, ctrFactor: 0.96, roasFactor: 1.0, hook: 0.26 },
  { id: 'cr-901', campaignId: 't-03', name: 'TopView Launch Teaser', format: 'video', headline: 'Something new is coming', color: '#0f766e', weight: 1, ctrFactor: 1, roasFactor: 1, hook: 0.47 },
  { id: 'cr-1001', campaignId: 't-04', name: 'Catalog Auto-Video', format: 'video', headline: 'Shop the collection', color: '#be185d', weight: 1, ctrFactor: 1, roasFactor: 1, hook: 0.24 },
];

// --------------------------------------------------------- Generation ----

export const HISTORY_DAYS = 190;

interface DayMods {
  active: boolean;
  roas: number;
  ctr: number;
  freq: number;
  spend: number;
}

/** k = days before asOf (0 = the last reporting day). */
function scenarioMods(p: CampaignProfile, k: number): DayMods {
  const m: DayMods = { active: k < p.ageDays, roas: 1, ctr: 1, freq: 1, spend: 1 };
  // ramp-up in the first week after launch
  const sinceLaunch = p.ageDays - 1 - k;
  if (sinceLaunch < 7) m.spend *= 0.55 + 0.065 * sinceLaunch;

  switch (p.scenario) {
    case 'cpaSpike':
      if (k === 0) m.roas *= 0.58;
      break;
    case 'roasDrop':
      if (k <= 4) m.roas *= 0.55;
      break;
    case 'spendStopped':
      if (k <= 1) m.active = false;
      break;
    case 'pausedRecently':
      if (k < 26) m.active = false;
      break;
    case 'fatigue':
      if (k <= 20) {
        const t = (20 - k) / 20; // 0 -> 1 over the last three weeks
        m.freq *= 1 + 1.45 * t;
        m.ctr *= 1 - 0.4 * t;
        m.roas *= 1 - 0.28 * t;
      }
      break;
    case 'learning':
      m.roas *= 0.85 + 0.015 * sinceLaunch;
      break;
    case 'freqCreep':
    default:
      break;
  }
  return m;
}

function campaignDaily(p: CampaignProfile, asOf: ISODate): CampaignDailyMetric[] {
  const rows: CampaignDailyMetric[] = [];
  for (let k = HISTORY_DAYS - 1; k >= 0; k--) {
    const date = addDays(asOf, -k);
    const mods = scenarioMods(p, k);
    if (!mods.active) continue; // platforms return no row for zero-delivery days
    const r = rngFor(p.id, date);
    const dow = parseISO(date).getUTCDay();
    const weekly = dow === 0 || dow === 6 ? 1.08 : dow === 1 ? 0.95 : 1;
    const growth = 0.92 + 0.1 * ((HISTORY_DAYS - k) / HISTORY_DAYS);

    const spend = p.dailyBudget * p.pace * weekly * growth * mods.spend * r(0.92, 1.08);
    const cpm = p.cpm * r(0.93, 1.07);
    const impressions = Math.round((spend / cpm) * 1000);
    const t = (HISTORY_DAYS - k) / HISTORY_DAYS;
    const frequency = (p.freq[0] + (p.freq[1] - p.freq[0]) * t) * mods.freq * r(0.97, 1.03);
    const reach = Math.round(impressions / Math.max(1, frequency / 3.2));
    const ctr = p.ctr * mods.ctr * r(0.94, 1.06);
    const clicks = Math.round(impressions * ctr);
    const roas = p.roas * mods.roas * r(0.93, 1.07);
    const revenue = spend * roas;
    const conversions = revenue / (p.aov * r(0.97, 1.03));

    rows.push({
      date,
      campaignId: p.id,
      spend: round2(spend),
      impressions,
      reach,
      clicks,
      conversions: round2(conversions),
      revenue: round2(revenue),
      frequency: round2(frequency),
    });
  }
  return rows;
}

function creativeDaily(c: CreativeProfile, rows: CampaignDailyMetric[], asOf: ISODate): CreativeDailyMetric[] {
  const out: CreativeDailyMetric[] = [];
  for (const row of rows) {
    const k = Math.round((parseISO(asOf).getTime() - parseISO(row.date).getTime()) / 86_400_000);
    const r = rngFor(c.id, row.date);
    let ctrMult = c.ctrFactor * r(0.95, 1.05);
    let freqMult = r(0.96, 1.04);
    let roasMult = c.roasFactor * r(0.95, 1.05);
    if (c.fatigue && k <= 16) {
      const t = (16 - k) / 16;
      freqMult *= 1 + 0.9 * t;
      ctrMult *= 1 - 0.38 * t;
      roasMult *= 1 - 0.25 * t;
    }
    const share = c.weight * r(0.93, 1.07);
    const impressions = Math.round(row.impressions * share);
    const ctr = (row.clicks / Math.max(1, row.impressions)) * ctrMult;
    const spend = row.spend * share;
    const revenue = row.revenue * share * roasMult;
    const aov = row.conversions > 0 ? row.revenue / row.conversions : 80;
    out.push({
      date: row.date,
      creativeId: c.id,
      campaignId: c.campaignId,
      spend: round2(spend),
      impressions,
      clicks: Math.round(impressions * ctr),
      conversions: round2(revenue / aov),
      revenue: round2(revenue),
      videoViews3s: c.hook > 0 ? Math.round(impressions * c.hook * r(0.94, 1.06) * (c.fatigue && k <= 16 ? 1 - 0.2 * ((16 - k) / 16) : 1)) : 0,
      frequency: round2(row.frequency * freqMult),
    });
  }
  return out;
}

/** Build the full mock dataset with `asOf` as the last complete reporting day. */
export function generateDataset(asOf: ISODate): Dataset {
  const campaigns: Campaign[] = PROFILES.map((p) => ({
    id: p.id,
    accountId: accountFor(p.channel),
    channel: p.channel,
    name: p.name,
    objective: p.objective,
    status: p.status,
    dailyBudget: p.dailyBudget,
    monthlyBudget: Math.round((p.dailyBudget * 30.4 * p.plan) / 100) * 100,
    startDate: addDays(asOf, -(p.ageDays - 1)),
  }));

  const campaignRows = new Map<string, CampaignDailyMetric[]>();
  for (const p of PROFILES) campaignRows.set(p.id, campaignDaily(p, asOf));

  const creatives: Creative[] = CREATIVES.map((c) => ({
    id: c.id,
    campaignId: c.campaignId,
    channel: PROFILES.find((p) => p.id === c.campaignId)!.channel,
    name: c.name,
    format: c.format,
    headline: c.headline,
    color: c.color,
  }));

  const creativeRows = CREATIVES.flatMap((c) => creativeDaily(c, campaignRows.get(c.campaignId)!, asOf));

  return {
    accounts: ACCOUNTS,
    campaigns,
    creatives,
    campaignDaily: [...campaignRows.values()].flat(),
    creativeDaily: creativeRows,
    asOf,
  };
}
