import { describe, expect, it } from 'vitest';
import { DAY_MS, daysLeft, isSubscriptionActive, nextPeriodEnd, periodDaysForMonths } from './period.ts';

const now = new Date('2026-11-14T10:00:00Z');
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

describe('nextPeriodEnd', () => {
  it('starts a fresh 30-day period from now when there is no current period', () => {
    expect(nextPeriodEnd(null, now).toISOString()).toBe('2026-12-14T10:00:00.000Z');
  });

  it('starts from now when the current period already ended (no back-dating)', () => {
    expect(nextPeriodEnd(plusDays(now, -10), now)).toEqual(plusDays(now, 30));
  });

  it('stacks on top of a period that is still running (early renewal / paying during trial)', () => {
    const trialEnd = plusDays(now, 5);
    expect(nextPeriodEnd(trialEnd, now)).toEqual(plusDays(now, 35));
  });

  it('supports multi-month manual payments', () => {
    expect(nextPeriodEnd(null, now, periodDaysForMonths(3))).toEqual(plusDays(now, 90));
  });

  it('treats an end exactly at now as expired', () => {
    expect(nextPeriodEnd(now, now)).toEqual(plusDays(now, 30));
  });

  it('rejects invalid lengths', () => {
    expect(() => nextPeriodEnd(null, now, 0)).toThrow();
    expect(() => nextPeriodEnd(null, now, Number.NaN)).toThrow();
  });
});

describe('daysLeft', () => {
  it('rounds partial days up and floors at 0', () => {
    expect(daysLeft(plusDays(now, 13.2), now)).toBe(14);
    expect(daysLeft(plusDays(now, 14), now)).toBe(14);
    expect(daysLeft(new Date(now.getTime() + 60_000), now)).toBe(1);
    expect(daysLeft(plusDays(now, -1), now)).toBe(0);
  });
  it('returns null for a period that never ends', () => {
    expect(daysLeft(null, now)).toBeNull();
  });
});

describe('isSubscriptionActive', () => {
  it('is active for trialing/active inside the period', () => {
    expect(isSubscriptionActive('trialing', plusDays(now, 1), now)).toBe(true);
    expect(isSubscriptionActive('active', plusDays(now, 1), now)).toBe(true);
    expect(isSubscriptionActive('active', null, now)).toBe(true);
  });
  it('is locked once the period ends or status is past_due/canceled', () => {
    expect(isSubscriptionActive('trialing', plusDays(now, -0.01), now)).toBe(false);
    expect(isSubscriptionActive('past_due', plusDays(now, 5), now)).toBe(false);
    expect(isSubscriptionActive('canceled', null, now)).toBe(false);
  });
});

describe('periodDaysForMonths', () => {
  it('accepts 1-12 whole months', () => {
    expect(periodDaysForMonths(1)).toBe(30);
    expect(periodDaysForMonths(12)).toBe(360);
    expect(() => periodDaysForMonths(0)).toThrow();
    expect(() => periodDaysForMonths(1.5)).toThrow();
    expect(() => periodDaysForMonths(13)).toThrow();
  });
});
