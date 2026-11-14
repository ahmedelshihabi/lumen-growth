import { useEffect, useState, type ReactNode } from 'react';
import type { Route } from '../lib/useHashRoute';
import { useApp } from '../state/AppContext';
import { cx } from './ui';
import {
  IconAlerts,
  IconCampaigns,
  IconClose,
  IconCreatives,
  IconLogo,
  IconMenu,
  IconMoon,
  IconOverview,
  IconPacing,
  IconRecs,
  IconSettings,
  IconSun,
} from './icons';

const NAV: { route: Route; label: string; icon: (p: object) => JSX.Element }[] = [
  { route: 'overview', label: 'Overview', icon: IconOverview },
  { route: 'campaigns', label: 'Campaigns', icon: IconCampaigns },
  { route: 'pacing', label: 'Budget pacing', icon: IconPacing },
  { route: 'creatives', label: 'Creatives', icon: IconCreatives },
  { route: 'alerts', label: 'Alerts', icon: IconAlerts },
  { route: 'recommendations', label: 'Recommendations', icon: IconRecs },
  { route: 'settings', label: 'Settings', icon: IconSettings },
];

export function Layout({ route, children, badges }: { route: Route; children: ReactNode; badges: Partial<Record<Route, number>> }) {
  const { theme, toggleTheme, data } = useApp();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [route]);

  const nav = (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Main">
      {NAV.map(({ route: r, label, icon: Icon }) => {
        const active = r === route;
        const count = badges[r];
        return (
          <a
            key={r}
            href={`#/${r}`}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
            )}
          >
            <Icon />
            <span className="flex-1">{label}</span>
            {count ? (
              <span
                className={cx(
                  'min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums',
                  active ? 'bg-white/20 text-current' : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
                )}
              >
                {count}
              </span>
            ) : null}
          </a>
        );
      })}
    </nav>
  );

  const brand = (
    <a href="#/overview" className="flex items-center gap-2.5 px-6 py-5">
      <IconLogo />
      <span className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Lumen Growth</span>
    </a>
  );

  const themeButton = (
    <button
      onClick={toggleTheme}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    >
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  );

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:flex">
        {brand}
        {nav}
        <div className="mt-auto border-t border-zinc-200 px-6 py-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <div className="flex items-center justify-between">
            <span>Demo workspace</span>
            {themeButton}
          </div>
          {data && <div className="mt-2">Data through {data.asOf}</div>}
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90 lg:hidden">
        <button
          onClick={() => setOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          aria-label="Open navigation"
        >
          <IconMenu />
        </button>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <IconLogo width={22} height={22} /> Lumen Growth
        </span>
        {themeButton}
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl dark:bg-zinc-900">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                aria-label="Close navigation"
              >
                <IconClose />
              </button>
            </div>
            {nav}
          </div>
        </div>
      )}

      <main className="lg:pl-60">
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
