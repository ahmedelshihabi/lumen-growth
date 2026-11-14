import { describe, expect, it } from 'vitest';
import {
  adsManagerUrl,
  base64Bytes,
  buildAdPayload,
  buildAdSetPayload,
  buildCampaignPayload,
  buildCreativePayload,
  toFormFields,
  validateCreateAdInput,
  type CreateAdInput,
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
