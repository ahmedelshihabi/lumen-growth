/**
 * Pure helpers for creating a Meta campaign -> ad set -> creative -> ad from one
 * form. No I/O: validation + Graph API payload builders, shared by the
 * meta-create-ad Edge Function and the frontend form (same validation rules).
 *
 * Everything is created PAUSED. The advertiser reviews it in Ads Manager and
 * turns it on there, so Lumen never starts spending money on its own.
 */
import { majorToMinor } from './meta.ts';

export const CREATE_OBJECTIVES = ['OUTCOME_TRAFFIC', 'OUTCOME_SALES'] as const;
export type CreateObjective = (typeof CREATE_OBJECTIVES)[number];

export const CTA_TYPES = ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'CONTACT_US', 'ORDER_NOW'] as const;
export type CtaType = (typeof CTA_TYPES)[number];

export const GENDERS = ['all', 'male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

export interface CreateAdInput {
  /** 'act_123...' */
  adAccountId: string;
  pageId: string;
  objective: CreateObjective;
  /** Meta pixel / dataset id. Required for OUTCOME_SALES. */
  pixelId?: string;
  campaignName: string;
  /** Daily budget in the account currency's major unit (e.g. 150 = EGP 150). */
  dailyBudget: number;
  /** ISO 3166-1 alpha-2 codes, e.g. ['EG', 'SA']. */
  countries: string[];
  ageMin: number;
  ageMax: number;
  gender: Gender;
  url: string;
  primaryText: string;
  headline: string;
  description?: string;
  cta: CtaType;
}

export type CreateAdErrorCode =
  | 'ad_account_required'
  | 'page_required'
  | 'objective_invalid'
  | 'pixel_required'
  | 'name_required'
  | 'budget_invalid'
  | 'budget_too_low'
  | 'countries_required'
  | 'country_invalid'
  | 'age_invalid'
  | 'gender_invalid'
  | 'url_invalid'
  | 'primary_text_required'
  | 'headline_required'
  | 'text_too_long'
  | 'cta_invalid';

/**
 * Smallest daily budget we accept, in major units of the account currency.
 * Meta rejects ad sets below its own per-currency minimum; we check first so
 * the user gets a clear message instead of a Graph API error.
 */
// VERIFY: Meta's minimum daily budget per currency for IMPRESSIONS billing
// (roughly USD 1/day; it changes with exchange rates). The EGP/SAR/AED values
// are conservative estimates, the Graph API still has the final word.
export const MIN_DAILY_BUDGET: Record<string, number> = { USD: 1, EUR: 1, EGP: 50, SAR: 4, AED: 4, KWD: 1, QAR: 4, BHD: 1, OMR: 1 };
export const minDailyBudget = (currency: string) => MIN_DAILY_BUDGET[currency.toUpperCase()] ?? 1;

export const MAX_TEXT = { campaignName: 200, primaryText: 2000, headline: 255, description: 255 };

const isNonEmpty = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;

export function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/** Validates a form submission. Returns error codes (empty = valid). */
export function validateCreateAdInput(i: CreateAdInput, currency: string): CreateAdErrorCode[] {
  const e: CreateAdErrorCode[] = [];
  if (!isNonEmpty(i.adAccountId) || !/^act_\d+$/.test(i.adAccountId)) e.push('ad_account_required');
  if (!isNonEmpty(i.pageId) || !/^\d+$/.test(i.pageId)) e.push('page_required');
  if (!(CREATE_OBJECTIVES as readonly string[]).includes(i.objective)) e.push('objective_invalid');
  if (i.objective === 'OUTCOME_SALES' && (!isNonEmpty(i.pixelId) || !/^\d+$/.test(i.pixelId))) e.push('pixel_required');
  if (!isNonEmpty(i.campaignName)) e.push('name_required');
  if (typeof i.dailyBudget !== 'number' || !Number.isFinite(i.dailyBudget) || i.dailyBudget <= 0) e.push('budget_invalid');
  else if (i.dailyBudget < minDailyBudget(currency)) e.push('budget_too_low');
  if (!Array.isArray(i.countries) || i.countries.length === 0) e.push('countries_required');
  else if (i.countries.some((c) => typeof c !== 'string' || !/^[A-Z]{2}$/.test(c))) e.push('country_invalid');
  if (
    !Number.isInteger(i.ageMin) ||
    !Number.isInteger(i.ageMax) ||
    i.ageMin < 18 ||
    i.ageMax > 65 ||
    i.ageMin > i.ageMax
  )
    e.push('age_invalid');
  if (!(GENDERS as readonly string[]).includes(i.gender)) e.push('gender_invalid');
  if (!isNonEmpty(i.url) || !isValidHttpUrl(i.url)) e.push('url_invalid');
  if (!isNonEmpty(i.primaryText)) e.push('primary_text_required');
  if (!isNonEmpty(i.headline)) e.push('headline_required');
  if (
    (i.campaignName?.length ?? 0) > MAX_TEXT.campaignName ||
    (i.primaryText?.length ?? 0) > MAX_TEXT.primaryText ||
    (i.headline?.length ?? 0) > MAX_TEXT.headline ||
    (i.description?.length ?? 0) > MAX_TEXT.description
  )
    e.push('text_too_long');
  if (!(CTA_TYPES as readonly string[]).includes(i.cta)) e.push('cta_invalid');
  return e;
}

/** Graph API params. Object values are JSON-encoded when sent as form fields. */
export type GraphParams = Record<string, string | number | boolean | object>;

// VERIFY: campaign fields for v24. When the budget lives on the ad set (no campaign
// budget), Meta now requires is_adset_budget_sharing_enabled to be set explicitly.
export function buildCampaignPayload(i: CreateAdInput): GraphParams {
  return {
    name: i.campaignName.trim(),
    objective: i.objective,
    status: 'PAUSED',
    buying_type: 'AUCTION',
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  };
}

export function buildTargeting(i: CreateAdInput): Record<string, unknown> {
  const t: Record<string, unknown> = {
    geo_locations: { countries: [...new Set(i.countries)] },
    age_min: i.ageMin,
    age_max: i.ageMax,
    // Respect the age/gender the user picked instead of letting Advantage+ audience widen it.
    // VERIFY: targeting_automation.advantage_audience must be sent explicitly (0 or 1) on new ad sets.
    targeting_automation: { advantage_audience: 0 },
  };
  if (i.gender === 'male') t.genders = [1];
  if (i.gender === 'female') t.genders = [2];
  return t;
}

export function buildAdSetPayload(i: CreateAdInput, campaignId: string, currency: string): GraphParams {
  const sales = i.objective === 'OUTCOME_SALES';
  const p: GraphParams = {
    name: `${i.campaignName.trim()} - Ad set`,
    campaign_id: campaignId,
    status: 'PAUSED',
    daily_budget: majorToMinor(i.dailyBudget, currency),
    billing_event: 'IMPRESSIONS',
    // VERIFY: OFFSITE_CONVERSIONS + promoted_object {pixel_id, custom_event_type: PURCHASE}
    // is the correct pair for OUTCOME_SALES website ad sets.
    optimization_goal: sales ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    destination_type: 'WEBSITE',
    targeting: buildTargeting(i),
  };
  if (sales) p.promoted_object = { pixel_id: i.pixelId, custom_event_type: 'PURCHASE' };
  return p;
}

// VERIFY: link ad creative via object_story_spec.link_data (link, message, name,
// description, image_hash, call_to_action.value.link).
export function buildCreativePayload(i: CreateAdInput, imageHash?: string): GraphParams {
  const link_data: Record<string, unknown> = {
    link: i.url.trim(),
    message: i.primaryText.trim(),
    name: i.headline.trim(),
    call_to_action: { type: i.cta, value: { link: i.url.trim() } },
  };
  if (i.description?.trim()) link_data.description = i.description.trim();
  if (imageHash) link_data.image_hash = imageHash;
  return {
    name: `${i.campaignName.trim()} - Creative`,
    object_story_spec: { page_id: i.pageId, link_data },
  };
}

export function buildAdPayload(i: CreateAdInput, adSetId: string, creativeId: string): GraphParams {
  return {
    name: `${i.campaignName.trim()} - Ad`,
    adset_id: adSetId,
    creative: { creative_id: creativeId },
    status: 'PAUSED',
  };
}

/** Flattens params for an application/x-www-form-urlencoded Graph API POST. */
export function toFormFields(p: GraphParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return out;
}

export function adsManagerUrl(adAccountId: string, campaignId?: string): string {
  const act = adAccountId.replace(/^act_/, '');
  const q = new URLSearchParams({ act });
  if (campaignId) q.set('selected_campaign_ids', campaignId);
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?${q.toString()}`;
}

/** Image upload limits enforced in the browser and again in the Edge Function. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png'];

/** Decoded size of a base64 string, without decoding it. */
export function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}
