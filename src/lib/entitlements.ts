import { daysLeft, isSubscriptionActive, type SubscriptionStatus } from '../../supabase/functions/_shared/period.ts';
import type { AppRoute } from './router';
import type { FeatureKey, Plan } from './plans';

export interface SubscriptionInfo {
  plan_id: string;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
}

export interface Entitlements {
  /** Workspace may use the app (and write). False -> read-only lock screen. */
  active: boolean;
  trialing: boolean;
  /** Days left in the trial or paid period; null = never expires. */
  daysLeft: number | null;
  plan: Plan | null;
  features: Set<FeatureKey>;
  maxAdAccounts: number;
  maxMembers: number;
}

/** Which plan feature each app page needs (null = always available, even when locked). */
export const ROUTE_FEATURE: Record<AppRoute, FeatureKey | 'unlocked' | 'active'> = {
  overview: 'overview',
  campaigns: 'campaigns',
  pacing: 'pacing',
  creatives: 'creatives',
  alerts: 'alerts',
  recommendations: 'recommendations',
  create: 'create_ads',
  settings: 'active',
  connect: 'active',
  billing: 'unlocked',
};

export function computeEntitlements(sub: SubscriptionInfo | null, plans: Plan[], now: Date = new Date()): Entitlements {
  const plan = sub ? plans.find((p) => p.id === sub.plan_id) ?? null : null;
  const end = sub?.current_period_end ? new Date(sub.current_period_end) : null;
  const active = !!sub && !!plan && isSubscriptionActive(sub.status, end, now);
  return {
    active,
    trialing: active && sub!.status === 'trialing',
    daysLeft: sub ? daysLeft(end, now) : 0,
    plan,
    features: new Set(active && plan ? plan.features : []),
    maxAdAccounts: active && plan ? plan.max_ad_accounts : 0,
    maxMembers: plan?.max_members ?? 1,
  };
}

export type RouteAccess = 'ok' | 'locked' | 'upgrade';

export function routeAccess(route: AppRoute, e: Entitlements): RouteAccess {
  const need = ROUTE_FEATURE[route];
  if (need === 'unlocked') return 'ok';
  if (!e.active) return 'locked';
  if (need === 'active') return 'ok';
  return e.features.has(need) ? 'ok' : 'upgrade';
}

/** Cheapest plan that includes a feature (for upgrade prompts). */
export function cheapestPlanWith(feature: FeatureKey, plans: Plan[]): Plan | null {
  return [...plans].filter((p) => p.features.includes(feature)).sort((a, b) => a.price_minor - b.price_minor)[0] ?? null;
}
