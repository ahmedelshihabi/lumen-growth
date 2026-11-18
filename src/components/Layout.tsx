import { useEffect, useState, type ReactNode } from 'react';
import { Link, appHref, type AppRoute } from '../lib/router';
import { routeAccess } from '../lib/entitlements';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { LanguageToggle, useI18n } from '../i18n';
import type { DictKey } from '../i18n/dict';
import { cx } from './ui';
import {
  IconAlerts,
  IconCampaigns,
  IconCard,
  IconClose,
  IconCreatives,
  IconLink,
  IconLock,
  IconLogo,
  IconLogout,
  IconMenu,
  IconMoon,
  IconOverview,
  IconPlus,
  IconPacing,
  IconRecs,
  IconSettings,
  IconShield,
  IconSun,
} from './icons';

const NAV: { route: AppRoute; label: DictKey; icon: (p: object) => JSX.Element }[] = [
  { route: 'overview', label: 'nav.overview', icon: IconOverview },
  { route: 'campaigns', label: 'nav.campaigns', icon: IconCampaigns },
  { route: 'pacing', label: 'nav.pacing', icon: IconPacing },
  { route: 'creatives', label: 'nav.creatives', icon: IconCreatives },
  { route: 'alerts', label: 'nav.alerts', icon: IconAlerts },
  { route: 'recommendations', label: 'nav.recommendations', icon: IconRecs },
  { route: 'create', label: 'nav.create', icon: IconPlus },
  { route: 'settings', label: 'nav.settings', icon: IconSettings },
];

const ACCOUNT_NAV: { route: AppRoute; label: DictKey; icon: (p: object) => JSX.Element }[] = [
  { route: 'connect', label: 'nav.connect', icon: IconLink },
  { route: 'billing', label: 'nav.billing', icon: IconCard },
];

export function Layout({ route, children, badges }: { route: AppRoute; children: ReactNode; badges: Partial<Record<AppRoute, number>> }) {
  const { theme, toggleTheme, data } = useApp();
  const session = useSession();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ent = session.entitlements;

  useEffect(() => setOpen(false), [route]);

  const item = ({ route: r, label, icon: Icon }: (typeof NAV)[number]) => {
    const active = r === route;
    const count = badges[r];
    const access = routeAccess(r, ent);
    return (
      <Link
        key={r}
        href={appHref(r)}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          active
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
            : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
        )}
      >
        <Icon />
        <span className="flex-1">{t(label)}</span>
        {access !== 'ok' ? (
          <IconLock width={14} height={14} className="opacity-60" aria-label="locked" />
        ) : count ? (
          <span
            className={cx(
              'min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums',
              active ? 'bg-white/20 text-current' : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
            )}
          >
            {count}
          </span>
        ) : null}
      </Link>
    );
  };

  const nav = (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Main">
      {NAV.map(item)}
      <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />
      {ACCOUNT_NAV.map(item)}
      {session.profile?.is_platform_admin && (
        <Link
          href="/admin"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <IconShield />
          <span className="flex-1">{t('common.admin')}</span>
        </Link>
      )}
    </nav>
  );

  const brand = (
    <Link href="/" className="flex items-center gap-2.5 px-6 py-5">
      <IconLogo />
      <span className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{t('app.name')}</span>
    </Link>
  );

  const iconBtn =
    'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';

  const themeButton = (
    <button onClick={toggleTheme} className={iconBtn} aria-label={theme === 'dark' ? t('common.lightMode') : t('common.darkMode')} title={theme === 'dark' ? t('common.lightMode') : t('common.darkMode')}>
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  );

  const signOut = (
    <button onClick={() => void session.signOut()} className={iconBtn} aria-label={t('common.signOut')} title={t('common.signOut')}>
      <IconLogout className="rtl:-scale-x-100" />
    </button>
  );

  const workspaceName = session.mode === 'demo' ? t('common.demoWorkspace') : session.workspace?.name ?? '';

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Desktop sidebar (inline-start edge: left in English, right in Arabic) */}
      <aside className="fixed inset-y-0 start-0 hidden w-60 flex-col border-e border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:flex">
        {brand}
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-zinc-200 px-6 py-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <div className="truncate font-medium text-zinc-700 dark:text-zinc-200" title={workspaceName}>
            <bdi>{workspaceName}</bdi>
          </div>
          {data && data.campaigns.length > 0 && <div className="mt-1">{t('common.dataThrough', { date: data.asOf })}</div>}
          <div className="mt-3 flex items-center gap-2">
            <LanguageToggle />
            {themeButton}
            {signOut}
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-zinc-200 bg-white/90 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90 lg:hidden">
        <button
          onClick={() => setOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          aria-label={t('common.openNav')}
        >
          <IconMenu />
        </button>
        <span className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold">
          <IconLogo width={22} height={22} /> {t('app.name')}
        </span>
        <div className="flex items-center gap-1.5">
          <LanguageToggle className="px-2" />
          {themeButton}
        </div>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 flex w-64 flex-col bg-white shadow-xl dark:bg-zinc-900">
            <div className="flex items-center justify-between pe-3">
              {brand}
              <button
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                aria-label={t('common.closeNav')}
              >
                <IconClose />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            <div className="flex items-center justify-between border-t border-zinc-200 px-6 py-3 text-xs text-zinc-500 dark:border-zinc-800">
              <span className="truncate"><bdi>{workspaceName}</bdi></span>
              {signOut}
            </div>
          </div>
        </div>
      )}

      <main className="lg:ps-60">
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
