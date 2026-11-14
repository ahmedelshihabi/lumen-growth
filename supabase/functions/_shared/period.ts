/**
 * Subscription period maths. Pure, no Deno/Node APIs: imported by the Edge
 * Functions AND by the frontend (src/lib/entitlements.ts), and unit tested
 * with Vitest (period.test.ts).
 */

export const DAY_MS = 86_400_000;
export const DEFAULT_PERIOD_DAYS = 30;

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

/**
 * New `current_period_end` after a successful payment of `days` days.
 *
 * - If the current period (trial or paid) is still running, the new days are
 *   stacked on top of it, so paying early never loses time.
 * - If it already ended (or there is none), the new period starts now.
 * - `currentEnd === null` with an active status means "never expires" (Free);
 *   paying then starts a normal period from now.
 */
export function nextPeriodEnd(currentEnd: Date | null, now: Date, days: number = DEFAULT_PERIOD_DAYS): Date {
  if (!Number.isFinite(days) || days <= 0) throw new Error(`invalid period length: ${days}`);
  const base = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd.getTime() : now.getTime();
  return new Date(base + Math.round(days) * DAY_MS);
}

/** Whole days left until `end`, rounded up (0 when expired, null when it never expires). */
export function daysLeft(end: Date | null, now: Date): number | null {
  if (!end) return null;
  const ms = end.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

/** True while a subscription grants access (trialing/active and not past its period end). */
export function isSubscriptionActive(status: SubscriptionStatus, end: Date | null, now: Date): boolean {
  if (status !== 'trialing' && status !== 'active') return false;
  return end === null || end.getTime() > now.getTime();
}

/** Days for a number of months bought at once (manual transfers can cover 1-12 months). */
export function periodDaysForMonths(months: number): number {
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new Error(`months must be 1-12, got ${months}`);
  return months * DEFAULT_PERIOD_DAYS;
}
