/**
 * Data access boundary.
 *
 * The UI only talks to a `DataSource`:
 *   - MockDataSource      seeded sample data ("Demo mode": no Supabase env vars, or ?demo)
 *   - SupabaseDataSource  (./supabaseSource.ts) reads the Meta insights cache in Supabase
 */
import type { AdAccount, Campaign, CampaignDailyMetric, Creative, CreativeDailyMetric, Dataset, DateRange, ISODate } from './types';
import { generateDataset, HISTORY_DAYS } from './mock';
import { addDays, localToday } from '../lib/dates';
import { filterRange } from '../lib/metrics';
import { DEFAULT_TARGETS } from '../rules/targets';
import type { TargetsByAccount } from '../rules/types';

export interface DataSource {
  readonly kind: 'mock' | 'supabase';
  /** Last complete reporting day available. */
  getAsOf(): Promise<ISODate>;
  getAccounts(): Promise<AdAccount[]>;
  getCampaigns(): Promise<Campaign[]>;
  getCreatives(): Promise<Creative[]>;
  /** Daily campaign-level insights within the range (inclusive). */
  getCampaignDaily(range: DateRange): Promise<CampaignDailyMetric[]>;
  /** Daily ad/creative-level insights within the range (inclusive). */
  getCreativeDaily(range: DateRange): Promise<CreativeDailyMetric[]>;
  /**
   * Persist per-campaign monthly budgets (Meta has none; pacing reads them).
   * `null` removes a budget.
   */
  saveMonthlyBudgets(budgets: Record<string, number | null>): Promise<void>;
  /** Saved account goals. Accounts without an entry get goals derived from their own history. */
  getTargets(): Promise<TargetsByAccount>;
  /** Save goals for the given accounts; `null` removes every saved goal (back to automatic). */
  saveTargets(targets: TargetsByAccount | null): Promise<void>;
}

const BUDGETS_KEY = 'lumen.demoBudgets.v1';
const TARGETS_KEY = 'lumen.targets.v1';

function readBudgetOverrides(): Record<string, number | null> {
  try {
    return JSON.parse(localStorage.getItem(BUDGETS_KEY) ?? '{}') as Record<string, number | null>;
  } catch {
    return {};
  }
}

export class MockDataSource implements DataSource {
  readonly kind = 'mock' as const;
  private readonly data: Dataset;

  constructor(asOf: ISODate = addDays(localToday(), -1)) {
    this.data = generateDataset(asOf);
  }

  async getAsOf() {
    return this.data.asOf;
  }
  async getAccounts() {
    return this.data.accounts;
  }
  async getCampaigns() {
    const o = readBudgetOverrides();
    return this.data.campaigns.map((c) => (c.id in o ? { ...c, monthlyBudget: o[c.id] ?? 0 } : c));
  }
  async getCreatives() {
    return this.data.creatives;
  }
  async getCampaignDaily(range: DateRange) {
    return filterRange(this.data.campaignDaily, range);
  }
  async getCreativeDaily(range: DateRange) {
    return filterRange(this.data.creativeDaily, range);
  }
  /** Demo mode keeps budget edits in this browser only. */
  async saveMonthlyBudgets(budgets: Record<string, number | null>) {
    const next = { ...readBudgetOverrides(), ...budgets };
    try {
      localStorage.setItem(BUDGETS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }
  /** Demo mode: the sample accounts' goals plus edits kept in this browser. */
  async getTargets(): Promise<TargetsByAccount> {
    try {
      return { ...DEFAULT_TARGETS, ...(JSON.parse(localStorage.getItem(TARGETS_KEY) ?? '{}') as TargetsByAccount) };
    } catch {
      return { ...DEFAULT_TARGETS };
    }
  }
  async saveTargets(targets: TargetsByAccount | null) {
    try {
      if (targets === null) localStorage.removeItem(TARGETS_KEY);
      else localStorage.setItem(TARGETS_KEY, JSON.stringify(targets));
    } catch {
      /* storage unavailable */
    }
  }
}

let source: DataSource | null = null;

/** The demo source (shared so its generated dataset is built once). */
export function getDataSource(): DataSource {
  if (!source) source = new MockDataSource();
  return source;
}

/**
 * Load everything the app needs in one go. The app keeps ~190 days in memory
 * (90-day range + equal comparison period); with real APIs you would page
 * and cache this server-side.
 */
export async function loadDataset(ds: DataSource = getDataSource(), days = HISTORY_DAYS): Promise<Dataset> {
  const asOf = await ds.getAsOf();
  const range = { start: addDays(asOf, -(days - 1)), end: asOf };
  const [accounts, campaigns, creatives, campaignDaily, creativeDaily] = await Promise.all([
    ds.getAccounts(),
    ds.getCampaigns(),
    ds.getCreatives(),
    ds.getCampaignDaily(range),
    ds.getCreativeDaily(range),
  ]);
  return { accounts, campaigns, creatives, campaignDaily, creativeDaily, asOf };
}
