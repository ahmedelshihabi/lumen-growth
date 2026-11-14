import { describe, expect, it } from 'vitest';
import { cheapestPlanWith, computeEntitlements, routeAccess, type SubscriptionInfo } from './entitlements';
import { DEMO_PLANS } from './plans';

const now = new Date('2026-11-14T00:00:00Z');
const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
const sub = (o: Partial<SubscriptionInfo>): SubscriptionInfo => ({ plan_id: 'growth', status: 'trialing', trial_ends_at: inDays(14), current_period_end: inDays(14), ...o });

describe('entitlements', () => {
  it('gives a new trial full Growth access with days left', () => {
    const e = computeEntitlements(sub({}), DEMO_PLANS, now);
    expect(e.active).toBe(true);
    expect(e.trialing).toBe(true);
    expect(e.daysLeft).toBe(14);
    expect(e.maxAdAccounts).toBe(5);
    expect(routeAccess('recommendations', e)).toBe('ok');
  });

  it('locks everything except billing when the trial ends', () => {
    const e = computeEntitlements(sub({ current_period_end: inDays(-1) }), DEMO_PLANS, now);
    expect(e.active).toBe(false);
    expect(e.daysLeft).toBe(0);
    expect(routeAccess('overview', e)).toBe('locked');
    expect(routeAccess('settings', e)).toBe('locked');
    expect(routeAccess('billing', e)).toBe('ok');
    expect(e.maxAdAccounts).toBe(0);
  });

  it('locks past_due subscriptions', () => {
    expect(computeEntitlements(sub({ status: 'past_due', current_period_end: inDays(3) }), DEMO_PLANS, now).active).toBe(false);
  });

  it('gates features by plan', () => {
    const starter = computeEntitlements(sub({ plan_id: 'starter', status: 'active' }), DEMO_PLANS, now);
    expect(routeAccess('pacing', starter)).toBe('ok');
    expect(routeAccess('creatives', starter)).toBe('upgrade');
    expect(routeAccess('settings', starter)).toBe('ok');
  });

  it('treats Free (no period end) as active forever', () => {
    const e = computeEntitlements(sub({ plan_id: 'free', status: 'active', current_period_end: null, trial_ends_at: null }), DEMO_PLANS, now);
    expect(e.active).toBe(true);
    expect(e.daysLeft).toBeNull();
    expect(routeAccess('alerts', e)).toBe('upgrade');
  });

  it('suggests the cheapest plan with a feature', () => {
    expect(cheapestPlanWith('alerts', DEMO_PLANS)?.id).toBe('starter');
    expect(cheapestPlanWith('creatives', DEMO_PLANS)?.id).toBe('growth');
  });
});
