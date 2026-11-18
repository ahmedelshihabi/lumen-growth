/**
 * Google Ads API constants and pure mapping helpers (no I/O). Imported by the
 * google-* Edge Functions and (for the OAuth URL) by the frontend.
 *
 * Id storage: Google rows reuse the existing text id columns with a `gads_` prefix
 * (ad_accounts.meta_account_id = 'gads_1234567890', campaigns.meta_campaign_id and
 * insights_daily.campaign_id = 'gads_<campaign id>') plus a `platform` column. That
 * keeps every unique key and the whole read path unchanged, and Meta ids ('act_…',
 * numeric campaign ids) can never collide with them.
 */

// VERIFY: pin to the newest Google Ads API version listed at
// developers.google.com/google-ads/api/docs/release-notes (each version lives ~1 year).
export const GOOGLE_ADS_API_VERSION = 'v21';
export const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
export const GADS_PREFIX = 'gads_';
/** Marker in the OAuth `state` so /app/connect can tell Google's redirect from Meta's. */
export const GOOGLE_STATE_PREFIX = 'google:';

/** Google OAuth consent URL (authorization code flow, offline access for a refresh token). */
export function googleOAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_ADS_SCOPE,
    access_type: 'offline',
    // Always show consent so Google returns a refresh_token even on reconnect.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: `${GOOGLE_STATE_PREFIX}${state}`,
  });
  return `${GOOGLE_AUTH_URL}?${p.toString()}`;
}

/** '123-456-7890' | 'customers/1234567890' | 1234567890 -> '1234567890' */
export function normalizeCustomerId(id: string | number): string {
  return String(id).replace(/^customers\//, '').replace(/\D/g, '');
}

export const gadsAccountId = (customerId: string | number) => `${GADS_PREFIX}${normalizeCustomerId(customerId)}`;
export const gadsCampaignId = (campaignId: string | number) => `${GADS_PREFIX}${String(campaignId)}`;
export const isGadsId = (id: string) => id.startsWith(GADS_PREFIX);
/** 'gads_1234567890' -> '1234567890' */
export const stripGads = (id: string) => (isGadsId(id) ? id.slice(GADS_PREFIX.length) : id);

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Google Ads money is in micros (1,000,000 = 1 unit of the account currency). */
export const microsToMajor = (micros: unknown): number => Math.round((num(micros) / 1_000_000) * 100) / 100;

// VERIFY: CampaignStatus enum values (ENABLED, PAUSED, REMOVED, UNKNOWN, UNSPECIFIED).
export function mapCampaignStatus(status: string | undefined): 'ACTIVE' | 'PAUSED' {
  return status === 'ENABLED' ? 'ACTIVE' : 'PAUSED';
}

/** Rough objective bucket from AdvertisingChannelType, to match the Meta mapping. */
// VERIFY: AdvertisingChannelType values (SEARCH, DISPLAY, SHOPPING, VIDEO, PERFORMANCE_MAX, DEMAND_GEN, ...).
export function mapChannelType(t: string | undefined): string {
  switch (t) {
    case 'SHOPPING':
    case 'PERFORMANCE_MAX':
      return 'SALES';
    case 'SEARCH':
      return 'TRAFFIC';
    case 'DISPLAY':
    case 'VIDEO':
    case 'DEMAND_GEN':
    case 'DISCOVERY':
      return 'AWARENESS';
    default:
      return t ?? 'UNKNOWN';
  }
}

/** One row of googleAds:searchStream for CAMPAIGN_DAILY_GAQL. Int64 values arrive as strings. */
// VERIFY: searchStream JSON uses lowerCamelCase field names (costMicros, conversionsValue, amountMicros).
export interface GadsCampaignRow {
  campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string; startDate?: string };
  campaignBudget?: { amountMicros?: string };
  segments?: { date?: string };
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
    conversions?: number | string;
    conversionsValue?: number | string;
  };
}

export interface GadsCustomerRow {
  customer?: { id?: string; descriptiveName?: string; currencyCode?: string; timeZone?: string; manager?: boolean; status?: string };
}

export const CUSTOMER_GAQL =
  'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status FROM customer LIMIT 1';

/** Campaign metadata (all campaigns, including ones with no spend in the window). */
export const CAMPAIGNS_GAQL =
  "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'";

/** Daily campaign metrics between two YYYY-MM-DD dates (inclusive). */
export function campaignDailyGaql(since: string, until: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error('bad_date');
  return (
    'SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, ' +
    'metrics.conversions, metrics.conversions_value FROM campaign ' +
    `WHERE segments.date BETWEEN '${since}' AND '${until}'`
  );
}

export interface GadsCampaignRecord {
  meta_campaign_id: string;
  name: string;
  objective: string;
  status: 'ACTIVE' | 'PAUSED';
  daily_budget: number | null;
  start_date: string | null;
}

export function mapCampaignRow(row: GadsCampaignRow): GadsCampaignRecord | null {
  const c = row.campaign;
  if (!c?.id || !c.name) return null;
  return {
    meta_campaign_id: gadsCampaignId(c.id),
    name: c.name,
    objective: mapChannelType(c.advertisingChannelType),
    status: mapCampaignStatus(c.status),
    daily_budget: row.campaignBudget?.amountMicros !== undefined ? microsToMajor(row.campaignBudget.amountMicros) : null,
    start_date: c.startDate && /^\d{4}-\d{2}-\d{2}$/.test(c.startDate) ? c.startDate : null,
  };
}

/** Same shape as meta.ts InsightDailyRecord (campaign level only for Google). */
export interface GadsInsightRecord {
  level: 'campaign';
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
  messaging_conversations: number;
}

export function mapCampaignDailyRow(row: GadsCampaignRow): GadsInsightRecord | null {
  const id = row.campaign?.id;
  const date = row.segments?.date;
  if (!id || !date) return null;
  const m = row.metrics ?? {};
  return {
    level: 'campaign',
    date,
    campaign_id: gadsCampaignId(id),
    ad_id: '',
    spend: microsToMajor(m.costMicros),
    impressions: Math.round(num(m.impressions)),
    // Google Ads has no daily reach/frequency at campaign level.
    reach: 0,
    clicks: Math.round(num(m.clicks)),
    conversions: Math.round(num(m.conversions) * 100) / 100,
    revenue: Math.round(num(m.conversionsValue) * 100) / 100,
    video_views_3s: 0,
    frequency: 0,
    messaging_conversations: 0,
  };
}

/** searchStream returns an array of batches, each with `results`. Flatten them. */
// VERIFY: REST searchStream response is a JSON array of {results: [...], fieldMask, requestId}.
export function flattenSearchStream<T>(batches: unknown): T[] {
  if (!Array.isArray(batches)) return [];
  const out: T[] = [];
  for (const b of batches) {
    const r = (b as { results?: T[] })?.results;
    if (Array.isArray(r)) out.push(...r);
  }
  return out;
}

/** Merge rows for the same campaign+date (searchStream can split a day across rows). */
export function mergeDaily(rows: readonly GadsInsightRecord[]): GadsInsightRecord[] {
  const byKey = new Map<string, GadsInsightRecord>();
  for (const r of rows) {
    const k = `${r.campaign_id}|${r.date}`;
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, { ...r });
    else {
      prev.spend = Math.round((prev.spend + r.spend) * 100) / 100;
      prev.impressions += r.impressions;
      prev.clicks += r.clicks;
      prev.conversions = Math.round((prev.conversions + r.conversions) * 100) / 100;
      prev.revenue = Math.round((prev.revenue + r.revenue) * 100) / 100;
    }
  }
  return [...byKey.values()];
}
