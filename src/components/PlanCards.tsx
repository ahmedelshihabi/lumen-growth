import type { ReactNode } from 'react';
import { ALL_FEATURES, formatPlanPrice, type Plan } from '../lib/plans';
import { useI18n } from '../i18n';
import { IconCheck } from './icons';
import { cx } from './ui';

/** Plan comparison cards shared by /pricing and /app/billing. */
export function PlanCards({ plans, action, currentPlanId }: { plans: Plan[]; action: (p: Plan) => ReactNode; currentPlanId?: string | null }) {
  const { t, lang, locale } = useI18n();
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {plans.map((p) => {
        const popular = p.tier === 'growth';
        const current = p.id === currentPlanId;
        return (
          <div
            key={p.id}
            className={cx(
              'relative flex flex-col rounded-xl border bg-white p-5 shadow-sm dark:bg-zinc-900',
              popular ? 'border-brand-500 ring-1 ring-brand-500' : 'border-zinc-200 dark:border-zinc-800',
            )}
          >
            {popular && (
              <span className="absolute -top-3 start-5 rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">{t('pricing.popular')}</span>
            )}
            <h3 className="text-base font-semibold">{lang === 'ar' ? p.name_ar : p.name_en}</h3>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tabular-nums tracking-tight">{p.price_minor === 0 ? t('pricing.free') : formatPlanPrice(p, locale)}</span>
              {p.price_minor > 0 && <span className="text-sm text-zinc-500 dark:text-zinc-400">{t('common.perMonth')}</span>}
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="font-medium">{p.max_ad_accounts === 1 ? t('pricing.adAccount') : t('pricing.adAccounts', { n: p.max_ad_accounts })}</li>
              <li className="font-medium">{p.max_members === 1 ? t('pricing.member') : t('pricing.members', { n: p.max_members })}</li>
              {ALL_FEATURES.filter((f) => p.features.includes(f)).map((f) => (
                <li key={f} className="flex items-start gap-2 text-zinc-600 dark:text-zinc-300">
                  <IconCheck width={16} height={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  {t(`feature.${f}`)}
                </li>
              ))}
            </ul>
            <div className={cx('mt-6 pt-2', current && 'opacity-90')}>{action(p)}</div>
          </div>
        );
      })}
    </div>
  );
}
