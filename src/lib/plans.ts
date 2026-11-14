/** Mirrors the `plans` seed in supabase/migrations. Used by /pricing in Demo mode. */
export type FeatureKey = 'overview' | 'campaigns' | 'pacing' | 'alerts' | 'creatives' | 'recommendations' | 'priority_support';

export interface Plan {
  id: string;
  tier: 'free' | 'starter' | 'growth' | 'agency';
  name_en: string;
  name_ar: string;
  currency: string;
  price_minor: number;
  interval_days: number;
  max_ad_accounts: number;
  max_members: number;
  features: FeatureKey[];
  sort_order: number;
}

const BASE: FeatureKey[] = ['overview', 'campaigns'];
const STARTER: FeatureKey[] = [...BASE, 'pacing', 'alerts'];
const GROWTH: FeatureKey[] = [...STARTER, 'creatives', 'recommendations'];

export const DEMO_PLANS: Plan[] = [
  { id: 'free', tier: 'free', name_en: 'Free', name_ar: 'مجاني', currency: 'EGP', price_minor: 0, interval_days: 30, max_ad_accounts: 1, max_members: 1, features: BASE, sort_order: 0 },
  { id: 'starter', tier: 'starter', name_en: 'Starter', name_ar: 'ستارتر', currency: 'EGP', price_minor: 99900, interval_days: 30, max_ad_accounts: 2, max_members: 2, features: STARTER, sort_order: 1 },
  { id: 'growth', tier: 'growth', name_en: 'Growth', name_ar: 'جروث', currency: 'EGP', price_minor: 249900, interval_days: 30, max_ad_accounts: 5, max_members: 5, features: GROWTH, sort_order: 2 },
  { id: 'agency', tier: 'agency', name_en: 'Agency', name_ar: 'إيجنسي', currency: 'EGP', price_minor: 699900, interval_days: 30, max_ad_accounts: 25, max_members: 15, features: [...GROWTH, 'priority_support'], sort_order: 3 },
];

export const ALL_FEATURES: FeatureKey[] = ['overview', 'campaigns', 'pacing', 'alerts', 'creatives', 'recommendations', 'priority_support'];

export function formatPlanPrice(p: Pick<Plan, 'price_minor' | 'currency'>, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: p.currency, maximumFractionDigits: 0 }).format(p.price_minor / 100);
}
