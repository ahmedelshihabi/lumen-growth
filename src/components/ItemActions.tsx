import { useState, type ReactNode } from 'react';
import { Link } from '../lib/router';
import { useI18n } from '../i18n';
import { useLoadedApp } from '../state/AppContext';
import type { SnoozeFor } from '../rules/keys';

/**
 * "Why am I seeing this?" + hide (24h / 7d / dismiss) for one alert or recommendation.
 * Hidden items are shared by the team and can be restored from the "Hidden" list.
 */
export function ItemActions({ itemKey, why }: { itemKey: string; why: ReactNode }) {
  const { t } = useI18n();
  const { hide } = useLoadedApp();
  const [open, setOpen] = useState(false);
  const opts: [SnoozeFor, string][] = [
    ['24h', t('hide.24h')],
    ['7d', t('hide.7d')],
    ['forever', t('hide.forever')],
  ];
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
          {t('why.toggle')}
        </button>
        <details className="relative">
          <summary className="cursor-pointer list-none font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
            {t('hide.menu')} ▾
          </summary>
          <div className="absolute start-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {opts.map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={(e) => {
                  (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                  hide(itemKey, f);
                }}
                className="block w-full px-3 py-2 text-start text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {label}
              </button>
            ))}
          </div>
        </details>
      </div>
      {open && (
        <div className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-xs leading-relaxed text-brand-950 dark:bg-brand-500/10 dark:text-brand-100">
          {why}{' '}
          <Link href="/app/settings" className="font-semibold underline-offset-2 hover:underline">
            {t('why.editRules')}
          </Link>
        </div>
      )}
    </div>
  );
}

/** Collapsible list of hidden items with their hide-until date and a restore button. */
export function HiddenList({ items }: { items: { key: string; title: ReactNode }[] }) {
  const { t, locale } = useI18n();
  const { dismissals, restore } = useLoadedApp();
  if (!items.length) return null;
  return (
    <details className="mt-4 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">{t('hide.hiddenCount', { n: items.length })}</summary>
      <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
        {items.map(({ key, title }) => {
          const until = dismissals[key];
          return (
            <li key={key} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{title}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {until ? t('hide.until', { date: new Date(until).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) }) : t('hide.dismissed')}
              </span>
              <button type="button" onClick={() => restore(key)} className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                {t('hide.restore')}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
