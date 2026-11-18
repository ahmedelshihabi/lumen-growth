import type { Campaign, CampaignDailyMetric, ISODate } from '../data/types';
import { addDays } from '../lib/dates';
import type { TargetsByAccount } from './types';

/** Default goals per ad account id (see src/data/mock.ts ACCOUNTS). */
export const DEFAULT_TARGETS: TargetsByAccount = {
  act_1048203311: { targetCpa: 1750, targetRoas: 2.5 },
  '482-913-2207': { targetCpa: 1600, targetRoas: 3.0 },
  '7190345528810': { targetCpa: 1900, targetRoas: 2.0 },
};

/**
 * Goals for accounts nobody has set goals for yet: the account's own average over the
 * last `days` days (CPA = spend / purchases, ROAS = revenue / spend). A hard-coded
 * fallback would be wrong in most currencies (CPA 35 is fine in USD, absurd in EGP),
 * so we benchmark each account against itself until the user enters real goals.
 * Accounts without purchases in the window get no entry (the engine's fallback applies).
 */
export function deriveTargets(
  campaigns: readonly Campaign[],
  campaignDaily: readonly CampaignDailyMetric[],
  asOf: ISODate,
  days = 30,
): TargetsByAccount {
  const accountOf = new Map(campaigns.map((c) => [c.id, c.accountId]));
  const start = addDays(asOf, -(days - 1));
  const sums = new Map<string, { spend: number; revenue: number; conversions: number }>();
  for (const r of campaignDaily) {
    if (r.date < start || r.date > asOf) continue;
    const acc = accountOf.get(r.campaignId);
    if (!acc) continue;
    const s = sums.get(acc) ?? { spend: 0, revenue: 0, conversions: 0 };
    s.spend += r.spend;
    s.revenue += r.revenue;
    s.conversions += r.conversions;
    sums.set(acc, s);
  }
  const out: TargetsByAccount = {};
  for (const [acc, s] of sums) {
    if (s.spend <= 0 || s.conversions <= 0 || s.revenue <= 0) continue;
    out[acc] = {
      targetCpa: Math.round(s.spend / s.conversions),
      targetRoas: Math.max(0.1, Math.round((s.revenue / s.spend) * 10) / 10),
    };
  }
  return out;
}
