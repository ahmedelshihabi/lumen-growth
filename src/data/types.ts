/**
 * Domain types for Lumen Growth.
 *
 * These are intentionally shaped after what the major ad platforms return
 * (Meta Marketing API insights, Google Ads GAQL reports, TikTok Business API
 * reports) after light normalization, so a real connector only needs to map
 * platform fields onto these shapes.
 */

export type Channel = 'meta' | 'google' | 'tiktok';

export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'LEARNING';

export type Objective = 'SALES' | 'LEADS' | 'TRAFFIC' | 'AWARENESS';

export type CreativeFormat = 'video' | 'image' | 'carousel';

/** ISO date, `YYYY-MM-DD`, in the ad account's reporting timezone. */
export type ISODate = string;

export interface AdAccount {
  /** e.g. Meta "act_123", Google customer id "123-456-7890", TikTok advertiser_id */
  id: string;
  name: string;
  channel: Channel;
  currency: string;
  timezone: string;
}

export interface Campaign {
  id: string;
  accountId: string;
  channel: Channel;
  name: string;
  objective: Objective;
  status: CampaignStatus;
  /** Daily budget in account currency (Meta daily_budget / Google budget amount / TikTok budget). */
  dailyBudget: number;
  /** Monthly budget plan set by the team (not a platform field; usually lives in a planning sheet). */
  monthlyBudget: number;
  startDate: ISODate;
}

export interface Creative {
  id: string;
  campaignId: string;
  channel: Channel;
  name: string;
  format: CreativeFormat;
  headline: string;
  /** Placeholder tile colour (hex) - stands in for a thumbnail URL. */
  color: string;
}

/** One row per campaign per day (platform "insights" at campaign level, daily breakdown). */
export interface CampaignDailyMetric {
  date: ISODate;
  campaignId: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  conversions: number;
  revenue: number;
  /** Rolling 7-day frequency as reported by the platform for that day. */
  frequency: number;
  /** Conversations started from click-to-message ads (WhatsApp / Messenger / Instagram). */
  conversations?: number;
}

/** One row per creative (ad) per day. */
export interface CreativeDailyMetric {
  date: ISODate;
  creativeId: string;
  campaignId: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  /** 3-second video plays (Meta video_play_actions / TikTok video_watched_2s). 0 for static. */
  videoViews3s: number;
  /** Rolling 7-day frequency for the ad. */
  frequency: number;
}

export interface DateRange {
  /** inclusive */
  start: ISODate;
  /** inclusive */
  end: ISODate;
}

/** Everything the UI needs, loaded once. */
export interface Dataset {
  accounts: AdAccount[];
  campaigns: Campaign[];
  creatives: Creative[];
  campaignDaily: CampaignDailyMetric[];
  creativeDaily: CreativeDailyMetric[];
  /** Last complete reporting day in the dataset. */
  asOf: ISODate;
}
