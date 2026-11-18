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
      <section className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-10">
        <div className="relative isolate overflow-hidden rounded-4xl bg-brand-600 px-6 pb-12 pt-12 text-white shadow-xl shadow-brand-600/25 sm:px-12 sm:pb-16 sm:pt-16">
          {/* Decorative shapes (brand palette): lime waves and a lilac spark. */}
          <svg aria-hidden className="pointer-events-none absolute -end-24 -top-10 -z-10 hidden h-[130%] w-[75%] opacity-95 sm:block" viewBox="0 0 600 600" fill="none">
            <path
              d="M40 120c140-10 300-30 360 40s-170 90-170 150 230-10 260 70-200 90-210 150 190 20 300 10"
              stroke="#D4FF4D"
              strokeWidth="70"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {/* Phones: a thin wave along the bottom instead of behind the text. */}
          <svg aria-hidden className="pointer-events-none absolute -bottom-6 start-0 -z-10 h-20 w-full sm:hidden" viewBox="0 0 400 80" preserveAspectRatio="none" fill="none">
            <path d="M-10 50c60-40 110 30 170 0s110-40 170-5 70 20 90 0" stroke="#D4FF4D" strokeWidth="26" strokeLinecap="round" />
          </svg>
          <svg aria-hidden className="pointer-events-none absolute -bottom-12 -start-14 -z-10 h-24 w-24 text-lilac-300 sm:-bottom-16 sm:-start-12 sm:h-40 sm:w-40" viewBox="0 0 100 100">
            <path fill="currentColor" d="M50 0l9 33 33-9-24 26 24 26-33-9-9 33-9-33-33 9 24-26L8 24l33 9z" />
          </svg>
          <div className="relative max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-zap-300 ring-1 ring-inset ring-white/20">
              {t('landing.badge')}
            </span>
            <h1 className="mt-5 text-4xl font-black leading-[1.15] tracking-tight sm:text-6xl">{t('landing.title')}</h1>
            <p className="mt-5 text-lg leading-relaxed text-brand-100">{t('landing.subtitle')}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={user ? '/app' : '/login'}
                className="inline-flex h-12 items-center rounded-full bg-zap-400 px-6 text-sm font-extrabold text-brand-950 shadow-lg shadow-black/10 transition hover:bg-zap-300"
              >
                {user ? t('nav.openApp') : t('nav.startTrial')}
              </Link>
              <Link
                href="/pricing"
                className="inline-flex h-12 items-center rounded-full border border-white/40 px-6 text-sm font-bold text-white hover:bg-white/10"
              >
                {t('landing.pricingCta')}
              </Link>
              {mode === 'live' && (
                <a href="/app?demo" className="text-sm font-semibold text-flamingo-200 underline-offset-4 hover:underline">
                  {t('nav.tryDemo')}
                </a>
              )}
            </div>
            <p className="mt-3 text-sm text-brand-100/90">{t('landing.trialNote')}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:px-6 md:grid-cols-3">
        {features.map(({ icon: Icon, title, body }, i) => (
          <div key={title} className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl text-brand-950 ${['bg-zap-400', 'bg-flamingo-300', 'bg-lilac-300'][i % 3]}`}>
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
