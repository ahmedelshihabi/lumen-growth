/**
 * Pure helpers for creating a Meta campaign -> ad set -> creative -> ad from one
 * form. No I/O: validation + Graph API payload builders, shared by the
 * meta-create-ad Edge Function and the frontend form (same validation rules).
 *
 * Everything is created PAUSED. The advertiser reviews it in Ads Manager and
 * turns it on there, so Lumen never starts spending money on its own.
 */
import { majorToMinor } from './meta.ts';

/**
 * OUTCOME_ENGAGEMENT is used for click-to-message ads (WhatsApp / Messenger / Instagram Direct).
 * OUTCOME_LEADS is website leads (pixel event); instant forms are not supported yet.
 */
export const CREATE_OBJECTIVES = ['OUTCOME_TRAFFIC', 'OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_ENGAGEMENT'] as const;
export type CreateObjective = (typeof CREATE_OBJECTIVES)[number];

export const MESSAGE_APPS = ['WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT'] as const;
export type MessageApp = (typeof MESSAGE_APPS)[number];

/** Pixel / dataset standard events Lumen lets you optimise for. */
export const CONVERSION_EVENTS = [
  'PURCHASE',
  'ADD_TO_CART',
  'INITIATED_CHECKOUT',
  'ADD_PAYMENT_INFO',
  'COMPLETE_REGISTRATION',
  'LEAD',
  'CONTACT',
  'CONTENT_VIEW',
] as const;
export type ConversionEvent = (typeof CONVERSION_EVENTS)[number];

export const CTA_TYPES = ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'CONTACT_US', 'ORDER_NOW', 'GET_OFFER', 'SUBSCRIBE', 'BOOK_NOW'] as const;
export type CtaType = (typeof CTA_TYPES)[number];

export const PLATFORMS = ['facebook', 'instagram', 'messenger', 'audience_network'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** A city (with radius) or region from GET /search?type=adgeolocation. */
export interface GeoLocation {
  key: string;
  name: string;
  type: 'city' | 'region';
  /** Cities only, in km (Meta allows 10-80 km; 0 = the city itself). */
  radiusKm?: number;
}

export interface CarouselCard {
  headline: string;
  description?: string;
  /** Defaults to the main URL. */
  url?: string;
}

export const MAX_CAROUSEL_CARDS = 10;
export const MAX_LOCATIONS = 50;
export const MAX_AUDIENCES = 20;

export const GENDERS = ['all', 'male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * Detailed-targeting categories Lumen can send in `flexible_spec`. These are the `type`
 * values returned by GET /{act}/targetingsearch and /targetingsuggestions.
 */
export const TARGETING_TYPES = [
  'interests',
  'behaviors',
  'life_events',
  'industries',
  'income',
  'family_statuses',
  'work_positions',
  'work_employers',
  'education_schools',
  'education_majors',
  'education_statuses',
  'relationship_statuses',
] as const;
export type TargetingType = (typeof TARGETING_TYPES)[number];
/** Types Meta expects as bare integers instead of {id, name}. */
const INTEGER_TARGETING_TYPES: readonly TargetingType[] = ['education_statuses', 'relationship_statuses'];
export const MAX_TARGETING_ITEMS = 50;

export interface TargetingItem {
  id: string;
  name: string;
  type: TargetingType;
}

/** A search/suggestion result shown in the picker. */
export interface TargetingOption extends TargetingItem {
  /** Category path, e.g. ['Interests', 'Technology', 'Consumer electronics']. */
  path: string[];
  sizeLower: number | null;
  sizeUpper: number | null;
}

interface RawTargetingRow {
  id?: string | number;
  name?: string;
  type?: string;
  path?: string[];
  audience_size_lower_bound?: number;
  audience_size_upper_bound?: number;
}

/** Keep only categories Lumen can send back, and normalise the shape. */
// VERIFY: field names on /targetingsearch and /targetingsuggestions results.
export function normalizeTargetingRows(rows: readonly RawTargetingRow[]): TargetingOption[] {
  const seen = new Set<string>();
  const out: TargetingOption[] = [];
  for (const r of rows) {
    if (r.id === undefined || !r.name || !(TARGETING_TYPES as readonly string[]).includes(r.type ?? '')) continue;
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: String(r.id),
      name: r.name,
      type: r.type as TargetingType,
      path: Array.isArray(r.path) ? r.path : [],
      sizeLower: typeof r.audience_size_lower_bound === 'number' ? r.audience_size_lower_bound : null,
      sizeUpper: typeof r.audience_size_upper_bound === 'number' ? r.audience_size_upper_bound : null,
    });
  }
  return out;
}

const TYPE_RANK: Partial<Record<TargetingType, number>> = { interests: 0, behaviors: 1 };

/**
 * Order search results the way a media buyer expects: the precise interest matches first
 * (in Meta's own order), then behaviours, then demographics / life events. `preciseCount`
 * is how many leading rows came from the exact interest search.
 */
export function rankTargetingOptions(options: TargetingOption[], preciseCount: number): TargetingOption[] {
  const precise = options.slice(0, preciseCount);
  const rest = options.slice(preciseCount);
  const rank = (o: TargetingOption) => TYPE_RANK[o.type] ?? 2;
  const restSorted = rest.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map((x) => x.o);
  return [...precise, ...restSorted];
}

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
  /** Interests, behaviours and demographics. People matching ANY of them are targeted. */
  detailedTargeting?: TargetingItem[];
  /** OUTCOME_ENGAGEMENT only: where the conversation happens. */
  messageApp?: MessageApp;
  /** OUTCOME_SALES / OUTCOME_LEADS: pixel event to optimise for (default PURCHASE / LEAD). */
  conversionEvent?: ConversionEvent;
  /** Cities/regions; when set they replace `countries` (Meta rejects overlapping locations). */
  locations?: GeoLocation[];
  /** Custom / lookalike audience ids to include and to exclude. */
  customAudiences?: string[];
  excludedAudiences?: string[];
  /** Let Meta expand beyond the audience (Advantage+ audience). Age max becomes 65. */
  advantageAudience?: boolean;
  /** Omit for Advantage+ placements (recommended). */
  platforms?: Platform[];
  /** Instagram account to show the ad from (else the Page's). */
  instagramUserId?: string;
  /** e.g. "utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}". */
  urlTags?: string;
  /** ISO timestamps; start defaults to now (Meta), end is optional. */
  startTime?: string;
  endTime?: string;
  /** 'carousel' uses `cards` (2-10) with one image each. */
  format?: 'single' | 'carousel';
  cards?: CarouselCard[];
}

export const isMessages = (i: Pick<CreateAdInput, 'objective'>) => i.objective === 'OUTCOME_ENGAGEMENT';
export const usesPixel = (i: Pick<CreateAdInput, 'objective'>) => i.objective === 'OUTCOME_SALES' || i.objective === 'OUTCOME_LEADS';
export const defaultEvent = (i: Pick<CreateAdInput, 'objective'>): ConversionEvent => (i.objective === 'OUTCOME_LEADS' ? 'LEAD' : 'PURCHASE');

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
  | 'cta_invalid'
  | 'targeting_invalid'
  | 'message_app_required'
  | 'event_invalid'
  | 'locations_invalid'
  | 'audiences_invalid'
  | 'platforms_invalid'
  | 'instagram_invalid'
  | 'url_tags_invalid'
  | 'schedule_invalid'
  | 'cards_invalid';

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
  if (usesPixel(i) && (!isNonEmpty(i.pixelId) || !/^\d+$/.test(i.pixelId))) e.push('pixel_required');
  if (isMessages(i) && !(MESSAGE_APPS as readonly string[]).includes(i.messageApp ?? '')) e.push('message_app_required');
  if (i.conversionEvent !== undefined && !(CONVERSION_EVENTS as readonly string[]).includes(i.conversionEvent)) e.push('event_invalid');
  if (!isNonEmpty(i.campaignName)) e.push('name_required');
  if (typeof i.dailyBudget !== 'number' || !Number.isFinite(i.dailyBudget) || i.dailyBudget <= 0) e.push('budget_invalid');
  else if (i.dailyBudget < minDailyBudget(currency)) e.push('budget_too_low');
  const hasLocations = Array.isArray(i.locations) && i.locations.length > 0;
  if (i.locations !== undefined) {
    const l = i.locations;
    if (
      !Array.isArray(l) ||
      l.length > MAX_LOCATIONS ||
      l.some(
        (g) =>
          !g ||
          !/^\d+$/.test(String(g.key)) ||
          (g.type !== 'city' && g.type !== 'region') ||
          (g.radiusKm !== undefined && (g.type !== 'city' || !(g.radiusKm === 0 || (g.radiusKm >= 10 && g.radiusKm <= 80)))),
      )
    )
      e.push('locations_invalid');
  }
  // Countries are ignored when cities/regions are chosen.
  if (!hasLocations && (!Array.isArray(i.countries) || i.countries.length === 0)) e.push('countries_required');
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
  // Messaging ads open a chat, so they don't need a website.
  if (!isMessages(i) && (!isNonEmpty(i.url) || !isValidHttpUrl(i.url))) e.push('url_invalid');
  const ids = (a: unknown) => Array.isArray(a) && a.length <= MAX_AUDIENCES && a.every((x) => typeof x === 'string' && /^\d+$/.test(x));
  if ((i.customAudiences !== undefined && !ids(i.customAudiences)) || (i.excludedAudiences !== undefined && !ids(i.excludedAudiences)))
    e.push('audiences_invalid');
  if (i.platforms !== undefined && (!Array.isArray(i.platforms) || i.platforms.length === 0 || i.platforms.some((p) => !(PLATFORMS as readonly string[]).includes(p))))
    e.push('platforms_invalid');
  if (i.instagramUserId !== undefined && !/^\d+$/.test(i.instagramUserId)) e.push('instagram_invalid');
  if (i.urlTags !== undefined && (i.urlTags.length > 500 || /\s/.test(i.urlTags) || /^[?&]/.test(i.urlTags))) e.push('url_tags_invalid');
  if (i.startTime !== undefined || i.endTime !== undefined) {
    const st = i.startTime ? Date.parse(i.startTime) : Date.now();
    const en = i.endTime ? Date.parse(i.endTime) : null;
    if (Number.isNaN(st) || (en !== null && (Number.isNaN(en) || en - st < 24 * 3600 * 1000))) e.push('schedule_invalid');
  }
  if (i.format === 'carousel') {
    const c = i.cards;
    if (
      !Array.isArray(c) ||
      c.length < 2 ||
      c.length > MAX_CAROUSEL_CARDS ||
      c.some((k) => !k || !isNonEmpty(k.headline) || k.headline.length > MAX_TEXT.headline || (k.url !== undefined && k.url !== '' && !isValidHttpUrl(k.url)))
    )
      e.push('cards_invalid');
  }
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
  if (i.detailedTargeting !== undefined) {
    const list = i.detailedTargeting;
    if (
      !Array.isArray(list) ||
      list.length > MAX_TARGETING_ITEMS ||
      list.some(
        (t) =>
          !t ||
          typeof t.id !== 'string' ||
          !/^\d+$/.test(t.id) ||
          typeof t.name !== 'string' ||
          !(TARGETING_TYPES as readonly string[]).includes(t.type),
      )
    )
      e.push('targeting_invalid');
  }
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
    geo_locations: buildGeo(i),
    age_min: i.ageMin,
    // VERIFY: with Advantage+ audience on, Meta only accepts age_max 65 (the range becomes a suggestion).
    age_max: i.advantageAudience ? 65 : i.ageMax,
    // VERIFY: targeting_automation.advantage_audience must be sent explicitly (0 or 1) on new ad sets.
    targeting_automation: { advantage_audience: i.advantageAudience ? 1 : 0 },
  };
  if (i.customAudiences?.length) t.custom_audiences = i.customAudiences.map((id) => ({ id }));
  if (i.excludedAudiences?.length) t.excluded_custom_audiences = i.excludedAudiences.map((id) => ({ id }));
  // Manual placements; omitted = Advantage+ placements.
  if (i.platforms?.length) t.publisher_platforms = [...new Set(i.platforms)];
  if (i.gender === 'male') t.genders = [1];
  if (i.gender === 'female') t.genders = [2];
  const items = i.detailedTargeting ?? [];
  if (items.length) {
    // One flexible_spec group = OR across every category in it ("people who match any").
    const group: Record<string, unknown[]> = {};
    for (const it of items) {
      const v = INTEGER_TARGETING_TYPES.includes(it.type) ? Number(it.id) : { id: it.id, name: it.name };
      (group[it.type] ??= []).push(v);
    }
    t.flexible_spec = [group];
  }
  return t;
}

/** Cities (with radius) / regions replace countries; Meta rejects a city inside a chosen country. */
export function buildGeo(i: CreateAdInput): Record<string, unknown> {
  const locs = i.locations ?? [];
  if (!locs.length) return { countries: [...new Set(i.countries)] };
  const g: Record<string, unknown> = {};
  const cities = locs.filter((l) => l.type === 'city');
  const regions = locs.filter((l) => l.type === 'region');
  // VERIFY: geo_locations.cities [{key, radius, distance_unit}] and regions [{key}].
  if (cities.length)
    g.cities = cities.map((c) => (c.radiusKm ? { key: String(c.key), radius: c.radiusKm, distance_unit: 'kilometer' } : { key: String(c.key) }));
  if (regions.length) g.regions = regions.map((x) => ({ key: String(x.key) }));
  return g;
}

export function buildAdSetPayload(i: CreateAdInput, campaignId: string, currency: string): GraphParams {
  const pixel = usesPixel(i);
  const msg = isMessages(i);
  const p: GraphParams = {
    name: `${i.campaignName.trim()} - Ad set`,
    campaign_id: campaignId,
    status: 'PAUSED',
    daily_budget: majorToMinor(i.dailyBudget, currency),
    billing_event: 'IMPRESSIONS',
    // VERIFY: OFFSITE_CONVERSIONS + promoted_object {pixel_id, custom_event_type} for website
    // sales/leads; CONVERSATIONS + destination WHATSAPP/MESSENGER/INSTAGRAM_DIRECT + promoted_object
    // {page_id} for click-to-message.
    optimization_goal: pixel ? 'OFFSITE_CONVERSIONS' : msg ? 'CONVERSATIONS' : 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    destination_type: msg ? (i.messageApp as string) : 'WEBSITE',
    targeting: buildTargeting(i),
  };
  if (pixel) p.promoted_object = { pixel_id: i.pixelId, custom_event_type: i.conversionEvent ?? defaultEvent(i) };
  if (msg) p.promoted_object = { page_id: i.pageId };
  if (i.startTime) p.start_time = i.startTime;
  if (i.endTime) p.end_time = i.endTime;
  return p;
}

/** Call to action and link for click-to-message ads. */
// VERIFY: CTA types and app_destination values for WhatsApp / Messenger / Instagram Direct,
// and that the link is a placeholder Meta ignores for these destinations.
const MESSAGE_CTA: Record<MessageApp, { type: string; link: string }> = {
  WHATSAPP: { type: 'WHATSAPP_MESSAGE', link: 'https://api.whatsapp.com/send' },
  MESSENGER: { type: 'MESSAGE_PAGE', link: 'https://fb.com/messenger_doc/' },
  INSTAGRAM_DIRECT: { type: 'INSTAGRAM_MESSAGE', link: 'https://www.instagram.com/' },
};

// VERIFY: link ad creative via object_story_spec.link_data (link, message, name,
// description, image_hash, call_to_action.value.link).
export function buildCreativePayload(i: CreateAdInput, imageHashes: string[] | string = []): GraphParams {
  const hashes = typeof imageHashes === 'string' ? [imageHashes] : imageHashes;
  const msg = isMessages(i) ? MESSAGE_CTA[i.messageApp as MessageApp] : null;
  const link = msg ? msg.link : i.url.trim();
  const cta = msg ? { type: msg.type, value: { app_destination: i.messageApp } } : { type: i.cta, value: { link } };
  const link_data: Record<string, unknown> = {
    link,
    message: i.primaryText.trim(),
    name: i.headline.trim(),
    call_to_action: cta,
  };
  if (i.description?.trim()) link_data.description = i.description.trim();
  if (i.format === 'carousel' && i.cards?.length) {
    // VERIFY: carousel = link_data.child_attachments (2-10) each with its own image_hash.
    link_data.child_attachments = i.cards.map((c, n) => {
      const url = msg ? link : c.url?.trim() || i.url.trim();
      const card: Record<string, unknown> = {
        link: url,
        name: c.headline.trim(),
        call_to_action: msg ? cta : { type: i.cta, value: { link: url } },
      };
      if (c.description?.trim()) card.description = c.description.trim();
      if (hashes[n]) card.image_hash = hashes[n];
      return card;
    });
    link_data.multi_share_optimized = true;
  } else if (hashes[0]) {
    link_data.image_hash = hashes[0];
  }
  const story: Record<string, unknown> = { page_id: i.pageId, link_data };
  // VERIFY: object_story_spec.instagram_user_id (replaces the deprecated instagram_actor_id).
  if (i.instagramUserId) story.instagram_user_id = i.instagramUserId;
  const p: GraphParams = { name: `${i.campaignName.trim()} - Creative`, object_story_spec: story };
  if (i.urlTags && !msg) p.url_tags = i.urlTags;
  return p;
}

/** Default UTM tags, using Meta's dynamic URL parameters. */
export const DEFAULT_URL_TAGS = 'utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}';

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
