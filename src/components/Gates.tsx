import { Link } from '../lib/router';
import { cheapestPlanWith } from '../lib/entitlements';
import type { FeatureKey } from '../lib/plans';
import { useSession } from '../state/SessionContext';
import { useI18n } from '../i18n';
import { Card } from './ui';
import { IconLink, IconLock } from './icons';

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900';

export function LockScreen() {
  const { t } = useI18n();
  const { subscription } = useSession();
  const reason = subscription?.status === 'trialing' ? t('lock.trialEnded') : t('lock.lapsed');
  return (
    <Card className="mx-auto mt-6 max-w-xl p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        <IconLock width={22} height={22} />
      </div>
      <h1 className="mt-4 text-xl font-semibold">{t('lock.title')}</h1>
      <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">{reason}</p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('lock.body')}</p>
      <Link href="/app/billing" className={`${primaryBtn} mt-6`}>
        {t('lock.cta')}
      </Link>
    </Card>
  );
}

export function UpgradeNotice({ feature }: { feature: FeatureKey }) {
  const { t, lang } = useI18n();
  const { plans } = useSession();
  const plan = cheapestPlanWith(feature, plans);
  return (
    <Card className="mx-auto mt-6 max-w-xl p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
        <IconLock width={22} height={22} />
      </div>
      <h1 className="mt-4 text-xl font-semibold">{t('upgrade.title', { feature: t(`feature.${feature}`) })}</h1>
      {plan && <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('upgrade.body', { plan: lang === 'ar' ? plan.name_ar : plan.name_en })}</p>}
      <Link href="/app/billing" className={`${primaryBtn} mt-6`}>
        {t('upgrade.cta')}
      </Link>
    </Card>
  );
}

export function NoDataYet() {
  const { t } = useI18n();
  return (
    <Card className="mx-auto mt-6 max-w-xl p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
        <IconLink width={22} height={22} />
      </div>
      <h1 className="mt-4 text-xl font-semibold">{t('nodata.title')}</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('nodata.body')}</p>
      <Link href="/app/connect" className={`${primaryBtn} mt-6`}>
        {t('nodata.cta')}
      </Link>
    </Card>
  );
}

export function SessionBanner() {
  const { t } = useI18n();
  const { mode, entitlements } = useSession();
  const showTrial = entitlements.trialing && entitlements.daysLeft !== null;
  if (mode !== 'demo' && !showTrial) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-900 dark:border-brand-800 dark:bg-brand-500/10 dark:text-brand-100">
      {mode === 'demo' && <span className="font-medium">{t('common.demoBanner')}</span>}
      {showTrial && <span>{t('trial.banner', { n: entitlements.daysLeft! })}</span>}
      {showTrial && (
        <Link href="/app/billing" className="ms-auto font-semibold underline-offset-2 hover:underline">
          {t('trial.bannerCta')}
        </Link>
      )}
    </div>
  );
}

export { primaryBtn };
