import { describe, expect, it } from 'vitest';
import {
  adsManagerUrl,
  base64Bytes,
  buildAdPayload,
  buildAdSetPayload,
  buildCampaignPayload,
  buildCreativePayload,
  buildTargeting,
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
