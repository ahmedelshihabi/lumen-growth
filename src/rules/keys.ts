import type { Anomaly } from './anomalies';
import type { Recommendation } from './recommendations';

/**
 * Stable keys for hiding items. Alert ids contain the date, so snoozing "CPA spike on X"
 * must use type + campaign (or account), not the id, or it would be back tomorrow.
 */
export const alertKey = (a: Pick<Anomaly, 'type' | 'campaignId' | 'campaignName'>) => `alert:${a.type}:${a.campaignId || a.campaignName}`;
export const recKey = (r: Pick<Recommendation, 'id'>) => `rec:${r.id}`;

export type SnoozeFor = '24h' | '7d' | 'forever';

export function snoozeUntil(f: SnoozeFor, now = Date.now()): string | null {
  if (f === 'forever') return null;
  return new Date(now + (f === '24h' ? 1 : 7) * 86_400_000).toISOString();
}

/** Hidden = dismissed for good, or snoozed until a time still in the future. */
export function isHidden(dismissals: Record<string, string | null>, key: string, now = Date.now()): boolean {
  if (!(key in dismissals)) return false;
  const until = dismissals[key];
  return until === null || Date.parse(until) > now;
}
