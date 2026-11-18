import { describe, expect, it } from 'vitest';
import { budgetToMajor, lastNDaysRange, mapInsightRow, mapObjective, metaOAuthDialogUrl, GRAPH_VERSION } from './meta.ts';

describe('mapInsightRow', () => {
  const row = {
    date_start: '2026-11-10',
    campaign_id: '120200000001',
    ad_id: '120200000099',
    spend: '1234.567',
    impressions: '50000',
    reach: '30000',
    clicks: '800',
    frequency: '1.6667',
    actions: [
      { action_type: 'link_click', value: '800' },
      { action_type: 'video_view', value: '9000' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '12' },
      { action_type: 'omni_purchase', value: '12' },
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '37' },
    ],
    action_values: [
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '6000.5' },
      { action_type: 'omni_purchase', value: '6000.5' },
    ],
  };

  it('maps a campaign-level row and does not double count purchases', () => {
    expect(mapInsightRow(row, 'campaign')).toEqual({
      level: 'campaign', date: '2026-11-10', campaign_id: '120200000001', ad_id: '',
      spend: 1234.57, impressions: 50000, reach: 30000, clicks: 800,
      conversions: 12, revenue: 6000.5, video_views_3s: 9000, frequency: 1.667, messaging_conversations: 37,
    });
  });

  it('keeps ad_id for ad-level rows and drops rows without ids', () => {
    expect(mapInsightRow(row, 'ad')?.ad_id).toBe('120200000099');
    expect(mapInsightRow({ ...row, ad_id: undefined }, 'ad')).toBeNull();
    expect(mapInsightRow({ ...row, campaign_id: undefined }, 'campaign')).toBeNull();
  });

  it('defaults missing metrics to 0', () => {
    const r = mapInsightRow({ date_start: '2026-11-10', campaign_id: '1' }, 'campaign')!;
    expect([r.spend, r.conversions, r.revenue, r.video_views_3s, r.messaging_conversations]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('helpers', () => {
  it('converts minor-unit budgets', () => {
    expect(budgetToMajor('150000', 'EGP')).toBe(1500);
    expect(budgetToMajor('5000', 'JPY')).toBe(5000);
    expect(budgetToMajor(undefined, 'EGP')).toBeNull();
  });
  it('maps ODAX objectives', () => {
    expect(mapObjective('OUTCOME_SALES')).toBe('SALES');
    expect(mapObjective('OUTCOME_LEADS')).toBe('LEADS');
    expect(mapObjective('OUTCOME_TRAFFIC')).toBe('TRAFFIC');
    expect(mapObjective('OUTCOME_AWARENESS')).toBe('AWARENESS');
  });
  it('builds a 30-day window ending yesterday', () => {
    expect(lastNDaysRange(new Date('2026-11-14T08:00:00Z'), 30)).toEqual({ since: '2026-10-15', until: '2026-11-13' });
  });
  it('builds the login dialog URL with a pinned version', () => {
    const u = new URL(metaOAuthDialogUrl('123', 'https://app.example.com/app/connect', 'st'));
    expect(u.pathname).toBe(`/${GRAPH_VERSION}/dialog/oauth`);
    expect(u.searchParams.get('scope')).toBe('ads_read,ads_management,pages_show_list,pages_read_engagement');
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.example.com/app/connect');
  });
});

describe('attribution windows', () => {
  const row = {
    date_start: '2026-11-10', campaign_id: '1',
    actions: [{ action_type: 'omni_purchase', value: '10', '7d_click': '7', '1d_view': '2' }],
    action_values: [{ action_type: 'omni_purchase', value: '1000', '7d_click': '700', '1d_view': '150' }],
  };
  it('uses the default value without windows and sums the chosen windows otherwise', () => {
    expect(mapInsightRow(row, 'campaign')!.conversions).toBe(10);
    const r = mapInsightRow(row, 'campaign', ['7d_click', '1d_view'])!;
    expect([r.conversions, r.revenue]).toEqual([9, 850]);
    expect(mapInsightRow(row, 'campaign', ['1d_click'])!.conversions).toBe(10); // field missing -> default
  });
});
