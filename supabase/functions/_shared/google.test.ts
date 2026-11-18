import { describe, expect, it } from 'vitest';
import {
  campaignDailyGaql,
  flattenSearchStream,
  gadsAccountId,
  googleOAuthUrl,
  mapCampaignDailyRow,
  mapCampaignRow,
  mapCampaignStatus,
  mergeDaily,
  microsToMajor,
  normalizeCustomerId,
  stripGads,
  GOOGLE_STATE_PREFIX,
} from './google.ts';

describe('google ids and money', () => {
  it('normalises customer ids and prefixes them', () => {
    expect(normalizeCustomerId('123-456-7890')).toBe('1234567890');
    expect(normalizeCustomerId('customers/1234567890')).toBe('1234567890');
    expect(gadsAccountId('123-456-7890')).toBe('gads_1234567890');
    expect(stripGads('gads_1234567890')).toBe('1234567890');
    expect(stripGads('act_1')).toBe('act_1');
  });

  it('converts micros to major units', () => {
    expect(microsToMajor('12345678')).toBe(12.35);
    expect(microsToMajor(undefined)).toBe(0);
  });

  it('maps campaign status', () => {
    expect(mapCampaignStatus('ENABLED')).toBe('ACTIVE');
    expect(mapCampaignStatus('PAUSED')).toBe('PAUSED');
    expect(mapCampaignStatus('REMOVED')).toBe('PAUSED');
  });
});

describe('googleOAuthUrl', () => {
  it('asks for offline adwords access and marks the state as Google', () => {
    const u = new URL(googleOAuthUrl('cid', 'https://x.app/app/connect', 'ws1'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/adwords');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('state')).toBe(`${GOOGLE_STATE_PREFIX}ws1`);
    expect(u.searchParams.get('redirect_uri')).toBe('https://x.app/app/connect');
  });
});

describe('GAQL row mapping', () => {
  const stream = [
    {
      results: [
        {
          campaign: { id: '111', status: 'ENABLED', name: 'Search | Brand', advertisingChannelType: 'SEARCH' },
          segments: { date: '2026-11-10' },
          metrics: { costMicros: '25500000', impressions: '1200', clicks: '80', conversions: 4, conversionsValue: 820.5 },
        },
      ],
    },
    {
      results: [
        { campaign: { id: '111' }, segments: { date: '2026-11-10' }, metrics: { costMicros: '500000', impressions: '10', clicks: '1', conversions: 0 } },
        { campaign: { id: '222' }, segments: { date: '2026-11-11' }, metrics: {} },
      ],
    },
  ];

  it('flattens searchStream batches and maps daily rows', () => {
    const rows = flattenSearchStream(stream).map(mapCampaignDailyRow).filter((r) => r !== null);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      level: 'campaign', date: '2026-11-10', campaign_id: 'gads_111', ad_id: '',
      spend: 25.5, impressions: 1200, reach: 0, clicks: 80, conversions: 4, revenue: 820.5,
      video_views_3s: 0, frequency: 0, messaging_conversations: 0,
    });
    expect(rows[2]?.spend).toBe(0);
  });

  it('merges split rows for the same campaign and day', () => {
    const rows = mergeDaily(flattenSearchStream(stream).map(mapCampaignDailyRow).filter((r) => r !== null) as never);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ campaign_id: 'gads_111', spend: 26, impressions: 1210, clicks: 81 });
  });

  it('maps campaign metadata', () => {
    expect(
      mapCampaignRow({
        campaign: { id: '333', name: 'PMax', status: 'PAUSED', advertisingChannelType: 'PERFORMANCE_MAX', startDate: '2026-10-01' },
        campaignBudget: { amountMicros: '150000000' },
      }),
    ).toEqual({ meta_campaign_id: 'gads_333', name: 'PMax', objective: 'SALES', status: 'PAUSED', daily_budget: 150, start_date: '2026-10-01' });
    expect(mapCampaignRow({ campaign: { id: '1' } })).toBeNull();
  });

  it('builds a date-bounded daily query and rejects bad dates', () => {
    expect(campaignDailyGaql('2026-10-19', '2026-11-17')).toContain("segments.date BETWEEN '2026-10-19' AND '2026-11-17'");
    expect(() => campaignDailyGaql("2026-10-19' OR 1=1", '2026-11-17')).toThrow();
  });
});
