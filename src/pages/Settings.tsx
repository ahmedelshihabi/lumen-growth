import { useEffect, useMemo, useState } from 'react';
import { Card, ChannelBadge, PageHeader } from '../components/ui';
import { useLoadedApp } from '../state/AppContext';
import type { TargetsByAccount } from '../rules/types';
import { targetFor } from '../rules/types';
import { getDisplayCurrency } from '../lib/format';
import { useI18n } from '../i18n';
import WorkspaceSettingsCards from '../components/WorkspaceSettingsCards';

type Draft = Record<string, { targetCpa: string; targetRoas: string }>;

function toDraft(t: TargetsByAccount, ids: string[]): Draft {
  return Object.fromEntries(
    ids.map((id) => {
      const v = targetFor(t, id);
      return [id, { targetCpa: String(v.targetCpa), targetRoas: String(v.targetRoas) }];
    }),
  );
}

const valid = (s: string) => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) > 0;
const validBudget = (s: string) => s.trim() === '' || (Number.isFinite(Number(s)) && Number(s) >= 0);

const input =
  'h-9 w-full rounded-lg border bg-white px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-900';
const primary =
  'rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white';

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-brand-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'start-[22px]' : 'start-0.5'}`} />
    </button>
  );
}

/** Per-campaign monthly budgets: Meta has none, so the team enters its plan; pacing reads it. */
function BudgetsCard() {
  const { data, source, reload } = useLoadedApp();
  const { t } = useI18n();
  const campaigns = useMemo(() => [...data.campaigns].sort((a, b) => a.name.localeCompare(b.name)), [data.campaigns]);
  const initial = useMemo(() => Object.fromEntries(campaigns.map((c) => [c.id, c.monthlyBudget > 0 ? String(c.monthlyBudget) : ''])), [campaigns]);
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');

  useEffect(() => setDraft(initial), [initial]);

  const changed = campaigns.filter((c) => (draft[c.id] ?? '') !== (initial[c.id] ?? ''));
  const allValid = Object.values(draft).every(validBudget);

  const save = async () => {
    if (!allValid || changed.length === 0) return;
    setState('saving');
    try {
      await source.saveMonthlyBudgets(
        Object.fromEntries(changed.map((c) => [c.id, draft[c.id].trim() === '' ? null : Number(draft[c.id])])),
      );
      setState('saved');
      reload();
      window.setTimeout(() => setState('idle'), 2000);
    } catch (e) {
      setState(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card className="mt-4" title={t('settings.budgets')}>
      <p className="px-4 pt-3 text-xs text-zinc-500 dark:text-zinc-400">{t('settings.budgetsNote')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {campaigns.map((c) => {
            const v = draft[c.id] ?? '';
            return (
              <li key={c.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" title={c.name}>
                    {c.name}
                  </div>
                  <ChannelBadge channel={c.channel} />
                </div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  <span className="sr-only">{c.name}</span>
                  {/* Same direction as the LTR number input, so the currency suffix and the padding are on the same side. */}
                  <div className="relative" dir="ltr">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="1"
                      dir="ltr"
                      value={v}
                      placeholder="-"
                      onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                      className={`${input} pe-14 ${validBudget(v) ? 'border-zinc-200 dark:border-zinc-700' : 'border-red-500'}`}
                    />
                    <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-zinc-400">{getDisplayCurrency()}</span>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <button type="submit" disabled={!allValid || changed.length === 0 || state === 'saving'} className={primary}>
            {t('settings.saveBudgets')}
          </button>
          <span role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
            {state === 'saved' ? t('common.saved') : ''}
          </span>
          {!allValid && <span className="text-sm text-red-600">{t('settings.budgetsInvalid')}</span>}
          {state !== 'idle' && state !== 'saved' && state !== 'saving' && <span className="text-sm text-red-600">{t('common.error', { message: state })}</span>}
        </div>
      </form>
    </Card>
  );
}

export default function Settings() {
  const { data, source, targets, autoTargetIds, setTargets, resetTargets, theme, toggleTheme } = useLoadedApp();
  const { t, lang, toggleLang } = useI18n();
  const ids = data.accounts.map((a) => a.id);
  const [draft, setDraft] = useState<Draft>(() => toDraft(targets, ids));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(toDraft(targets, data.accounts.map((a) => a.id)));
  }, [targets, data.accounts]);

  const allValid = Object.values(draft).every((d) => valid(d.targetCpa) && valid(d.targetRoas));
  const dirty = ids.some((id) => {
    const tg = targetFor(targets, id);
    return Number(draft[id]?.targetCpa) !== tg.targetCpa || Number(draft[id]?.targetRoas) !== tg.targetRoas;
  });

  const save = () => {
    if (!allValid) return;
    const next: TargetsByAccount = { ...targets };
    for (const id of ids) next[id] = { targetCpa: Number(draft[id].targetCpa), targetRoas: Number(draft[id].targetRoas) };
    setTargets(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <PageHeader title={t('nav.settings')} subtitle={t('settings.subtitle')} />

      <Card title={t('settings.goals')} action={<span className="text-xs text-zinc-500 dark:text-zinc-400">{t('settings.goalsNote')}</span>}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.accounts.map((a) => {
              const d = draft[a.id] ?? { targetCpa: '', targetRoas: '' };
              const set = (k: 'targetCpa' | 'targetRoas', v: string) => setDraft((prev) => ({ ...prev, [a.id]: { ...d, [k]: v } }));
              return (
                <li key={a.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_160px_160px] sm:items-end">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{a.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <ChannelBadge channel={a.channel} />
                      <span className="truncate" dir="ltr">
                        {t('settings.accountId', { id: a.id })}
                      </span>
                    </div>
                    {autoTargetIds.includes(a.id) && (
                      <div className="mt-1 text-xs font-medium text-sky-700 dark:text-sky-300">{t('settings.goalsAuto')}</div>
                    )}
                  </div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {t('settings.targetCpa')} ({a.currency})
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      dir="ltr"
                      value={d.targetCpa}
                      onChange={(e) => set('targetCpa', e.target.value)}
                      className={`${input} mt-1 ${valid(d.targetCpa) ? 'border-zinc-200 dark:border-zinc-700' : 'border-red-500'}`}
                    />
                  </label>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {t('settings.targetRoas')}
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.1"
                      dir="ltr"
                      value={d.targetRoas}
                      onChange={(e) => set('targetRoas', e.target.value)}
                      className={`${input} mt-1 ${valid(d.targetRoas) ? 'border-zinc-200 dark:border-zinc-700' : 'border-red-500'}`}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <button type="submit" disabled={!allValid || !dirty} className={primary}>
              {t('settings.saveGoals')}
            </button>
            <button
              type="button"
              onClick={resetTargets}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t('settings.reset')}
            </button>
            <span role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
              {saved ? t('common.saved') : ''}
            </span>
            {!allValid && <span className="text-sm text-red-600">{t('settings.goalsInvalid')}</span>}
          </div>
        </form>
      </Card>

      <WorkspaceSettingsCards />

      <BudgetsCard />

      <Card className="mt-4" title={t('settings.appearance')}>
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div>
            <div className="text-sm font-medium">{t('common.darkMode')}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{t('settings.darkModeBody')}</div>
          </div>
          <Switch on={theme === 'dark'} onClick={toggleTheme} label={t('common.darkMode')} />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
          <div>
            <div className="text-sm font-medium">{t('settings.languageTitle')}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{t('settings.languageBody')}</div>
          </div>
          <button
            type="button"
            onClick={toggleLang}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
      </Card>

      <Card className="mt-4" title={t('settings.dataSource')}>
        <div className="px-4 py-4 text-sm text-zinc-600 dark:text-zinc-300">
          {source.kind === 'mock'
            ? t('settings.dataMock', { campaigns: data.campaigns.length, creatives: data.creatives.length, date: data.asOf })
            : t('settings.dataLive', { campaigns: data.campaigns.length, date: data.asOf })}
        </div>
      </Card>
    </>
  );
}
