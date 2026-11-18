import type { DateRange, ISODate } from '../data/types';
import { addDays } from './dates';

export interface Totals {
  spend: number;
  revenue: number;
  impressions: number;
  clicks: number;
  conversions: number;
  roas: number;
  cpa: number;
  ctr: number;
  cpm: number;
  /** Conversations started from click-to-message ads (0 when not reported). */
  conversations: number;
  /** spend / conversations */
  costPerConversation: number;
}

export const safeDiv = (a: number, b: number): number => (b > 0 ? a / b : 0);

export interface Summable {
  spend: number;
  revenue: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversations?: number;
}

export function aggregate(rows: readonly Summable[]): Totals {
  let spend = 0;
  let revenue = 0;
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;
  let conversations = 0;
  for (const r of rows) {
    spend += r.spend;
    revenue += r.revenue;
    impressions += r.impressions;
    clicks += r.clicks;
    conversions += r.conversions;
    conversations += r.conversations ?? 0;
  }
  return {
    spend,
    revenue,
    impressions,
    clicks,
    conversions,
    roas: safeDiv(revenue, spend),
    cpa: safeDiv(spend, conversions),
    ctr: safeDiv(clicks, impressions),
    cpm: safeDiv(spend, impressions) * 1000,
    conversations,
    costPerConversation: safeDiv(spend, conversations),
  };
}

export function inRange(date: ISODate, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

/** Range of `days` days ending on `end` (inclusive). */
export function rangeEnding(end: ISODate, days: number): DateRange {
  return { start: addDays(end, -(days - 1)), end };
}

/** The equally long range immediately before `range`. */
export function previousRange(range: DateRange, days: number): DateRange {
  return rangeEnding(addDays(range.start, -1), days);
}

export function filterRange<T extends { date: ISODate }>(rows: readonly T[], range: DateRange): T[] {
  return rows.filter((r) => inRange(r.date, range));
}

/**
 * Latest reported frequency within the rows (platform frequency is already a
 * rolling window, so summing/averaging it would be wrong).
 */
export function latestFrequency(
  rows: readonly { date: ISODate; impressions: number; frequency: number }[],
): number {
  let bestDate = '';
  let f = 0;
  for (const r of rows) {
    if (r.impressions > 0 && r.date > bestDate) {
      bestDate = r.date;
      f = r.frequency;
    }
  }
  return f;
}

export function pctChange(curr: number, prev: number): number | null {
  if (!prev) return null;
  return (curr - prev) / prev;
}

export function groupBy<T>(rows: readonly T[], key: (r: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) {
    const k = key(r);
    (out[k] ||= []).push(r);
  }
  return out;
}
