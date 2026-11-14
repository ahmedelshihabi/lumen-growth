import type { Campaign, CampaignDailyMetric, Creative, CreativeDailyMetric, ISODate } from '../data/types';

export interface AccountTarget {
  /** Target cost per acquisition, account currency. */
  targetCpa: number;
  /** Target return on ad spend (revenue / spend). */
  targetRoas: number;
}

export type TargetsByAccount = Record<string, AccountTarget>;

/** Everything the rules engines consume. All rules are pure functions of this. */
export interface RulesInput {
  campaigns: Campaign[];
  campaignDaily: CampaignDailyMetric[];
  creatives: Creative[];
  creativeDaily: CreativeDailyMetric[];
  asOf: ISODate;
  targets: TargetsByAccount;
}

export const FALLBACK_TARGET: AccountTarget = { targetCpa: 35, targetRoas: 2.5 };

export function targetFor(targets: TargetsByAccount, accountId: string): AccountTarget {
  return targets[accountId] ?? FALLBACK_TARGET;
}
