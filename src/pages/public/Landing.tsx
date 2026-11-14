import { Link } from '../../lib/router';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import { IconAlerts, IconOverview, IconPacing } from '../../components/icons';
import { PublicLayout } from './PublicLayout';

export default function Landing() {
  const { t } = useI18n();
  const { user, mode } = useSession();
  const features = [
    { icon: IconOverview, title: t('landing.f1.title'), body: t('landing.f1.body') },
    { icon: IconPacing, title: t('landing.f2.title'), body: t('landing.f2.body') },
    { icon: IconAlerts, title: t('landing.f3.title'), body: t('landing.f3.body') },
  ];
  return (
    <PublicLayout>
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-14 sm:px-6 sm:pt-20">
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-300">
          {t('landing.badge')}
        </span>
        <h1 className="mt-5 max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{t('landing.title')}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-300">{t('landing.subtitle')}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href={user ? '/app' : '/login'}
            className="inline-flex h-11 items-center rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            {user ? t('nav.openApp') : t('nav.startTrial')}
          </Link>
          <Link
            href="/pricing"
            className="inline-flex h-11 items-center rounded-lg border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            {t('landing.pricingCta')}
          </Link>
          {mode === 'live' && (
            <a href="/app?demo" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
              {t('nav.tryDemo')}
            </a>
          )}
        </div>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('landing.trialNote')}</p>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:px-6 md:grid-cols-3">
        {features.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <Icon width={20} height={20} />
            </div>
            <h2 className="mt-4 text-base font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{body}</p>
          </div>
        ))}
      </section>
    </PublicLayout>
  );
}
