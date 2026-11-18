import { useEffect, useState } from 'react';
import { Link } from '../../lib/router';
import { useI18n } from '../../i18n';
import { loadPlans, useSession } from '../../state/SessionContext';
import { PlanCards } from '../../components/PlanCards';
import type { Plan } from '../../lib/plans';
import { PublicLayout } from './PublicLayout';
import { env } from '../../lib/supabase';

export default function Pricing() {
  const { t, lang } = useI18n();
  const session = useSession();
  const [plans, setPlans] = useState<Plan[]>(session.plans);

  useEffect(() => {
    let alive = true;
    void loadPlans().then((p) => alive && setPlans(p));
    return () => {
      alive = false;
    };
  }, []);

  const egp = plans.filter((p) => p.currency === 'EGP');
  const target = session.user ? '/app/billing' : '/login';

  return (
    <PublicLayout>
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('pricing.title')}</h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-300">{t(env.paymobEnabled ? 'pricing.subtitle' : 'pricing.subtitleManual')}</p>
        </div>
        <div className="mt-10">
          <PlanCards
            plans={egp}
            action={(p) => (
              <Link
                href={target}
                className={
                  p.tier === 'growth'
                    ? 'flex h-10 w-full items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700'
                    : 'flex h-10 w-full items-center justify-center rounded-lg border border-zinc-300 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'
                }
              >
                {p.price_minor === 0 ? t('pricing.startFree') : t('pricing.choose', { plan: lang === 'ar' ? p.name_ar : p.name_en })}
              </Link>
            )}
          />
        </div>
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          {t('pricing.trialNote')} {t('pricing.vat')}
        </p>
      </section>
    </PublicLayout>
  );
}
