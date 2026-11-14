/**
 * Meta Marketing API constants and pure mapping helpers (no I/O). Imported by
 * the Edge Functions and (for GRAPH_VERSION / OAuth URL) by the frontend.
 */

// VERIFY: pin to the newest Graph API version listed at
// developers.facebook.com/docs/graph-api/changelog. Versions stay callable for
// ~2 years; bump deliberately and re-test.
export const GRAPH_VERSION = 'v24.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Scopes requested at login. ads_read is enough to list ad accounts and read insights. */
export const META_SCOPES = ['ads_read'];

/** Facebook Login dialog URL (Authorization Code flow). */
export function metaOAuthDialogUrl(appId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: META_SCOPES.join(','),
  });
  // VERIFY: dialog host/path (www.facebook.com/{version}/dialog/oauth).
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${p.toString()}`;
}

export interface MetaAction {
  action_type: string;
  value: string;
}

/** One row of GET /{act_id}/insights with time_increment=1. Numbers arrive as strings. */
export interface MetaInsightRow {
  date_start: string;
  date_stop?: string;
  campaign_id?: string;
  campaign_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  frequency?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
}

export interface InsightDailyRecord {
  level: 'campaign' | 'ad';
  date: string;
  campaign_id: string;
  ad_id: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  conversions: number;
  revenue: number;
  video_views_3s: number;
  frequency: number;
}

// VERIFY: purchase action types. Meta reports the same purchase under several
// action_types; take the first present (in this priority) to avoid double counting.
export const PURCHASE_ACTION_TYPES = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase'];
// VERIFY: 'video_view' in `actions` is Meta's 3-second video view count.
export const VIDEO_3S_ACTION_TYPE = 'video_view';

const num = (s: string | number | undefined | null): number => {
  const n = typeof s === 'number' ? s : Number(s ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function pickAction(list: MetaAction[] | undefined, types: string[]): number {
  if (!list?.length) return 0;
  for (const t of types) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}

export function mapInsightRow(row: MetaInsightRow, level: 'campaign' | 'ad'): InsightDailyRecord | null {
  if (!row.campaign_id || !row.date_start) return null;
  if (level === 'ad' && !row.ad_id) return null;
  return {
    level,
    date: row.date_start,
    campaign_id: row.campaign_id,
    ad_id: level === 'ad' ? row.ad_id! : '',
    spend: Math.round(num(row.spend) * 100) / 100,
    impressions: Math.round(num(row.impressions)),
    reach: Math.round(num(row.reach)),
    clicks: Math.round(num(row.clicks)),
    conversions: pickAction(row.actions, PURCHASE_ACTION_TYPES),
    revenue: Math.round(pickAction(row.action_values, PURCHASE_ACTION_TYPES) * 100) / 100,
    video_views_3s: Math.round(pickAction(row.actions, [VIDEO_3S_ACTION_TYPE])),
    frequency: Math.round(num(row.frequency) * 1000) / 1000,
  };
}

/** Meta budgets are in the account currency's minor unit (cents) as strings. */
// VERIFY: a few currencies (e.g. JPY, KRW) have offset 1, not 100. EGP/AED/SAR/USD use 100.
export function budgetToMajor(minor: string | number | undefined | null, currency: string): number | null {
  if (minor === undefined || minor === null || minor === '') return null;
  const zeroDecimal = ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'TWD', 'HUF'].includes(currency.toUpperCase());
  return num(minor) / (zeroDecimal ? 1 : 100);
}

export function mapObjective(objective: string | undefined): 'SALES' | 'LEADS' | 'TRAFFIC' | 'AWARENESS' {
  const o = (objective ?? '').toUpperCase();
  if (o.includes('SALES') || o.includes('CONVERSIONS') || o.includes('PRODUCT_CATALOG')) return 'SALES';
  if (o.includes('LEAD')) return 'LEADS';
  if (o.includes('TRAFFIC') || o.includes('LINK_CLICKS') || o.includes('ENGAGEMENT')) return 'TRAFFIC';
  return 'AWARENESS';
}

/** Inclusive date window [today-days, yesterday] as YYYY-MM-DD (UTC). */
export function lastNDaysRange(today: Date, days: number): { since: string; until: string } {
  const d = (offset: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset)).toISOString().slice(0, 10);
  return { since: d(days), until: d(1) };
}
