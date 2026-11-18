import { describe, expect, it } from 'vitest';
import {
  adsManagerUrl,
  base64Bytes,
  buildAdPayload,
  buildAdSetPayload,
  buildCampaignPayload,
  buildCreativePayload,
  buildTargeting,
  buildGeo,
  DEFAULT_URL_TAGS,
  normalizeTargetingRows,
  rankTargetingOptions,
  toFormFields,
  validateCreateAdInput,
  type CreateAdInput,
  type TargetingOption,
} from './meta-create.ts';
import { majorToMinor, META_SCOPES } from './meta.ts';

const base: CreateAdInput = {
  adAccountId: 'act_123456',
  pageId: '987654321',
  objective: 'OUTCOME_TRAFFIC',
  campaignName: 'Winter sale',
  dailyBudget: 150,
  countries: ['EG'],
  ageMin: 21,
  ageMax: 45,
  gender: 'all',
  url: 'https://shop.example.com/sale',
  primaryText: 'Up to 50% off',
  headline: 'Winter sale',
  description: 'Free delivery',
  cta: 'SHOP_NOW',
};

describe('validateCreateAdInput', () => {
  it('accepts a valid traffic ad', () => {
    expect(validateCreateAdInput(base, 'EGP')).toEqual([]);
  });

  it('requires a pixel for sales', () => {
    expect(validateCreateAdInput({ ...base, objective: 'OUTCOME_SALES' }, 'EGP')).toContain('pixel_required');
    expect(validateCreateAdInput({ ...base, objective: 'OUTCOME_SALES', pixelId: '555' }, 'EGP')).toEqual([]);
  });

  it('flags bad budgets, ages, countries and URLs', () => {
    const errs = validateCreateAdInput(
      { ...base, dailyBudget: 10, ageMin: 16, countries: ['egypt'], url: 'javascript:alert(1)' },
      'EGP',
    );
    expect(errs).toEqual(expect.arrayContaining(['budget_too_low', 'age_invalid', 'country_invalid', 'url_invalid']));
    expect(validateCreateAdInput({ ...base, dailyBudget: 0 }, 'USD')).toContain('budget_invalid');
    expect(validateCreateAdInput({ ...base, ageMin: 40, ageMax: 30 }, 'USD')).toContain('age_invalid');
    expect(validateCreateAdInput({ ...base, countries: [] }, 'USD')).toContain('countries_required');
  });

  it('flags missing ids and texts', () => {
    const errs = validateCreateAdInput({ ...base, adAccountId: '123', pageId: '', primaryText: ' ', headline: '' }, 'USD');
    expect(errs).toEqual(expect.arrayContaining(['ad_account_required', 'page_required', 'primary_text_required', 'headline_required']));
  });
});

describe('payload builders', () => {
  it('creates everything paused', () => {
    expect(buildCampaignPayload(base).status).toBe('PAUSED');
    expect(buildAdSetPayload(base, 'c1', 'EGP').status).toBe('PAUSED');
    expect(buildAdPayload(base, 's1', 'cr1').status).toBe('PAUSED');
  });

  it('builds a traffic campaign with no special ad categories', () => {
    const c = buildCampaignPayload(base);
    expect(c).toMatchObject({ objective: 'OUTCOME_TRAFFIC', special_ad_categories: [], is_adset_budget_sharing_enabled: false });
  });

  it('converts the budget to minor units and maps targeting', () => {
    const s = buildAdSetPayload({ ...base, gender: 'female', countries: ['EG', 'SA', 'EG'] }, 'c1', 'EGP');
    expect(s.daily_budget).toBe(15000);
    expect(s.optimization_goal).toBe('LINK_CLICKS');
    expect(s.promoted_object).toBeUndefined();
    expect(s.targeting).toMatchObject({
      geo_locations: { countries: ['EG', 'SA'] },
      age_min: 21,
      age_max: 45,
      genders: [2],
      targeting_automation: { advantage_audience: 0 },
    });
    expect(majorToMinor(500, 'JPY')).toBe(500);
  });

  it('optimises sales ad sets for purchases on the pixel', () => {
    const s = buildAdSetPayload({ ...base, objective: 'OUTCOME_SALES', pixelId: '555' }, 'c1', 'USD');
    expect(s.optimization_goal).toBe('OFFSITE_CONVERSIONS');
    expect(s.promoted_object).toEqual({ pixel_id: '555', custom_event_type: 'PURCHASE' });
  });

  it('builds a link creative as the page', () => {
    const cr = buildCreativePayload(base, 'hash123');
    expect(cr.object_story_spec).toEqual({
      page_id: '987654321',
      link_data: {
        link: 'https://shop.example.com/sale',
        message: 'Up to 50% off',
        name: 'Winter sale',
        description: 'Free delivery',
        image_hash: 'hash123',
        call_to_action: { type: 'SHOP_NOW', value: { link: 'https://shop.example.com/sale' } },
      },
    });
  });

  it('JSON-encodes object fields for form posts', () => {
    const f = toFormFields(buildCampaignPayload(base));
    expect(f.special_ad_categories).toBe('[]');
    expect(f.is_adset_budget_sharing_enabled).toBe('false');
    expect(f.status).toBe('PAUSED');
  });
});

describe('misc', () => {
  it('links to the campaign in Ads Manager', () => {
    expect(adsManagerUrl('act_123', '456')).toBe(
      'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123&selected_campaign_ids=456',
    );
  });

  it('measures base64 payload size', () => {
    expect(base64Bytes(btoa('hello'))).toBe(5);
    expect(base64Bytes(btoa('hello!'))).toBe(6);
  });

  it('requests the scopes needed to create ads', () => {
    expect(META_SCOPES).toEqual(expect.arrayContaining(['ads_read', 'ads_management', 'pages_show_list']));
  });
});

describe('detailed targeting', () => {
  const items: CreateAdInput['detailedTargeting'] = [
    { id: '6003397425735', name: 'Headphones', type: 'interests' },
    { id: '6003107902433', name: 'Online shopping', type: 'interests' },
    { id: '6071631541183', name: 'Engaged Shoppers', type: 'behaviors' },
    { id: '3', name: 'Married', type: 'relationship_statuses' },
  ];

  it('puts every item in one flexible_spec group (people matching ANY of them)', () => {
    const t = buildTargeting({ ...base, detailedTargeting: items });
    expect(t.flexible_spec).toEqual([
      {
        interests: [
          { id: '6003397425735', name: 'Headphones' },
          { id: '6003107902433', name: 'Online shopping' },
        ],
        behaviors: [{ id: '6071631541183', name: 'Engaged Shoppers' }],
        relationship_statuses: [3],
      },
    ]);
  });

  it('sends no flexible_spec for broad targeting', () => {
    expect(buildTargeting({ ...base, detailedTargeting: [] }).flexible_spec).toBeUndefined();
    expect(buildTargeting(base).flexible_spec).toBeUndefined();
  });

  it('rejects unknown types, non-numeric ids and more than 50 items', () => {
    expect(validateCreateAdInput({ ...base, detailedTargeting: items }, 'EGP')).not.toContain('targeting_invalid');
    const bad = (d: unknown) => validateCreateAdInput({ ...base, detailedTargeting: d as CreateAdInput['detailedTargeting'] }, 'EGP');
    expect(bad([{ id: '1', name: 'x', type: 'custom_audiences' }])).toContain('targeting_invalid');
    expect(bad([{ id: 'abc', name: 'x', type: 'interests' }])).toContain('targeting_invalid');
    expect(bad(Array.from({ length: 51 }, (_, i) => ({ id: String(i + 1), name: 'x', type: 'interests' })))).toContain('targeting_invalid');
  });

  it('normalises search rows, keeping only sendable categories and dropping duplicates', () => {
    const out = normalizeTargetingRows([
      { id: '6003397425735', name: 'Headphones', type: 'interests', path: ['Interests', 'Technology'], audience_size_lower_bound: 1000, audience_size_upper_bound: 2000 },
      { id: '6003397425735', name: 'Headphones', type: 'interests' },
      { id: 99, name: 'Some audience', type: 'custom_audience' },
      { id: 3, name: 'Married', type: 'relationship_statuses' },
    ]);
    expect(out).toEqual([
      { id: '6003397425735', name: 'Headphones', type: 'interests', path: ['Interests', 'Technology'], sizeLower: 1000, sizeUpper: 2000 },
      { id: '3', name: 'Married', type: 'relationship_statuses', path: [], sizeLower: null, sizeUpper: null },
    ]);
  });
});

describe('rankTargetingOptions', () => {
  const o = (id: string, type: TargetingOption['type']): TargetingOption => ({ id, name: id, type, path: [], sizeLower: null, sizeUpper: null });
  it('keeps precise interest matches first, then behaviours, then demographics', () => {
    const ranked = rankTargetingOptions([o('1', 'interests'), o('2', 'interests'), o('3', 'life_events'), o('4', 'behaviors'), o('5', 'interests')], 2);
    expect(ranked.map((x) => x.id)).toEqual(['1', '2', '5', '4', '3']);
  });
});

describe('create ad: objectives, locations, audiences, placements, schedule, carousel', () => {
  it('messages: CONVERSATIONS to WhatsApp, page as promoted object, chat CTA, no website needed', () => {
    const i: CreateAdInput = { ...base, objective: 'OUTCOME_ENGAGEMENT', messageApp: 'WHATSAPP', url: '' };
    expect(validateCreateAdInput(i, 'EGP')).toEqual([]);
    const set = buildAdSetPayload(i, 'c1', 'EGP');
    expect([set.optimization_goal, set.destination_type, set.promoted_object]).toEqual(['CONVERSATIONS', 'WHATSAPP', { page_id: base.pageId }]);
    const cr = buildCreativePayload(i, ['h1']) as { object_story_spec: { link_data: Record<string, unknown> } };
    expect(cr.object_story_spec.link_data.call_to_action).toEqual({ type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } });
    expect(validateCreateAdInput({ ...i, messageApp: undefined }, 'EGP')).toContain('message_app_required');
  });

  it('leads and sales optimise for the chosen pixel event (default LEAD / PURCHASE)', () => {
    const leads = buildAdSetPayload({ ...base, objective: 'OUTCOME_LEADS', pixelId: '99' }, 'c', 'EGP');
    expect(leads.promoted_object).toEqual({ pixel_id: '99', custom_event_type: 'LEAD' });
    const atc = buildAdSetPayload({ ...base, objective: 'OUTCOME_SALES', pixelId: '99', conversionEvent: 'ADD_TO_CART' }, 'c', 'EGP');
    expect(atc.promoted_object).toEqual({ pixel_id: '99', custom_event_type: 'ADD_TO_CART' });
    expect(validateCreateAdInput({ ...base, objective: 'OUTCOME_LEADS' }, 'EGP')).toContain('pixel_required');
  });

  it('cities with radius and regions replace countries', () => {
    const i: CreateAdInput = {
      ...base,
      locations: [
        { key: '1522000', name: 'Cairo', type: 'city', radiusKm: 25 },
        { key: '1522002', name: 'Alexandria', type: 'city', radiusKm: 0 },
        { key: '3400', name: 'Giza Governorate', type: 'region' },
      ],
    };
    expect(buildGeo(i)).toEqual({
      cities: [{ key: '1522000', radius: 25, distance_unit: 'kilometer' }, { key: '1522002' }],
      regions: [{ key: '3400' }],
    });
    expect(validateCreateAdInput({ ...i, countries: [] }, 'EGP')).not.toContain('countries_required');
    expect(validateCreateAdInput({ ...i, locations: [{ key: '1', name: 'x', type: 'city', radiusKm: 5 }] }, 'EGP')).toContain('locations_invalid');
  });

  it('audiences, Advantage+ audience (age max 65) and manual placements go into targeting', () => {
    const t = buildTargeting({ ...base, ageMax: 40, customAudiences: ['11'], excludedAudiences: ['22'], advantageAudience: true, platforms: ['instagram', 'facebook', 'instagram'] });
    expect(t.custom_audiences).toEqual([{ id: '11' }]);
    expect(t.excluded_custom_audiences).toEqual([{ id: '22' }]);
    expect([t.age_max, t.targeting_automation]).toEqual([65, { advantage_audience: 1 }]);
    expect(t.publisher_platforms).toEqual(['instagram', 'facebook']);
    expect(buildTargeting(base).publisher_platforms).toBeUndefined(); // Advantage+ placements
    expect(validateCreateAdInput({ ...base, platforms: [] }, 'EGP')).toContain('platforms_invalid');
  });

  it('schedule needs >= 24h between start and end and is passed to the ad set', () => {
    const start = '2026-12-01T08:00:00.000Z';
    expect(buildAdSetPayload({ ...base, startTime: start, endTime: '2026-12-05T08:00:00.000Z' }, 'c', 'EGP').end_time).toBe('2026-12-05T08:00:00.000Z');
    expect(validateCreateAdInput({ ...base, startTime: start, endTime: '2026-12-01T20:00:00.000Z' }, 'EGP')).toContain('schedule_invalid');
  });

  it('carousel: one child attachment per card with its own image, UTM tags and Instagram account', () => {
    const i: CreateAdInput = {
      ...base,
      format: 'carousel',
      cards: [{ headline: 'A' }, { headline: 'B', description: 'b', url: 'https://shop.example/b' }],
      urlTags: DEFAULT_URL_TAGS,
      instagramUserId: '178414',
    };
    expect(validateCreateAdInput(i, 'EGP')).toEqual([]);
    const cr = buildCreativePayload(i, ['ha', 'hb']) as { url_tags: string; object_story_spec: { instagram_user_id: string; link_data: { child_attachments: Record<string, unknown>[] } } };
    expect(cr.object_story_spec.link_data.child_attachments.map((c) => [c.name, c.image_hash, c.link])).toEqual([
      ['A', 'ha', base.url],
      ['B', 'hb', 'https://shop.example/b'],
    ]);
    expect(cr.url_tags).toBe(DEFAULT_URL_TAGS);
    expect(cr.object_story_spec.instagram_user_id).toBe('178414');
    expect(validateCreateAdInput({ ...i, cards: [{ headline: 'only one' }] }, 'EGP')).toContain('cards_invalid');
    expect(validateCreateAdInput({ ...i, urlTags: '?utm_source=x' }, 'EGP')).toContain('url_tags_invalid');
  });
});
