import type { Campaign, CampaignDailyMetric, DateRange } from '../data/types';
import { aggregate, filterRange, groupBy, latestFrequency, type Totals } from '../lib/metrics';
import { campaignHealth, type Health } from './health';
import { targetFor, type AccountTarget, type TargetsByAccount } from './types';

export interface CampaignSummary {
  campaign: Campaign;
  totals: Totals;
  frequency: number;
  target: AccountTarget;
  health: Health;
}

export function summarizeCampaigns(
  campaigns: readonly Campaign[],
  daily: readonly CampaignDailyMetric[],
  range: DateRange,
  targets: TargetsByAccount,
): CampaignSummary[] {
  const byCampaign = groupBy(filterRange(daily, range), (r) => r.campaignId);
  return campaigns.map((campaign) => {
    const rows = byCampaign[campaign.id] ?? [];
    const totals = aggregate(rows);
    const target = targetFor(targets, campaign.accountId);
    return {
      campaign,
      totals,
      frequency: latestFrequency(rows),
      target,
      health: campaignHealth(totals, target),
    };
  });
}
