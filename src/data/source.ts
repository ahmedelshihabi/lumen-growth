/**
 * Data access boundary.
 *
 * The UI only talks to a `DataSource`. Today it is backed by the seeded mock
 * generator; to go live, implement this interface with real connectors
 * (Meta Marketing API, Google Ads API, TikTok Business API - usually via
 * your own backend that holds the OAuth tokens) and swap it in `getDataSource()`.
 */
import type { AdAccount, Campaign, CampaignDailyMetric, Creative, CreativeDailyMetric, Dataset, DateRange, ISODate } from './types';
import { generateDataset, HISTORY_DAYS } from './mock';
import { addDays, localToday } from '../lib/dates';
import { filterRange } from '../lib/metrics';

export interface DataSource {
  /** Last complete reporting day available. */
  getAsOf(): Promise<ISODate>;
  getAccounts(): Promise<AdAccount[]>;
  getCampaigns(): Promise<Campaign[]>;
  getCreatives(): Promise<Creative[]>;
  /** Daily campaign-level insights within the range (inclusive). */
  getCampaignDaily(range: DateRange): Promise<CampaignDailyMetric[]>;
  /** Daily ad/creative-level insights within the range (inclusive). */
  getCreativeDaily(range: DateRange): Promise<CreativeDailyMetric[]>;
}

export class MockDataSource implements DataSource {
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
    return this.data.campaigns;
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
}

let source: DataSource | null = null;

/** Swap the implementation here (or via env flag) when real connectors exist. */
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
