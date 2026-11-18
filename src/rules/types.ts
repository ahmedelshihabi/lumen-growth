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
  /** Ad account display names by account id (used by account-level alerts). */
  accountNames?: Record<string, string>;
  /** Thresholds from workspace settings (defaults when absent). */
  anomalyConfig?: import('./anomalies').AnomalyConfig;
  evalConfig?: import('./evaluate').EvalConfig;
}

export const FALLBACK_TARGET: AccountTarget = { targetCpa: 35, targetRoas: 2.5 };

export function targetFor(targets: TargetsByAccount, accountId: string): AccountTarget {
  return targets[accountId] ?? FALLBACK_TARGET;
}
