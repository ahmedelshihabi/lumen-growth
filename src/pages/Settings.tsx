import { useEffect, useState } from 'react';
import { Card, ChannelBadge, PageHeader } from '../components/ui';
import { useLoadedApp } from '../state/AppContext';
import type { TargetsByAccount } from '../rules/types';
import { targetFor } from '../rules/types';

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

export default function Settings() {
  const { data, targets, setTargets, resetTargets, theme, toggleTheme } = useLoadedApp();
  const ids = data.accounts.map((a) => a.id);
  const [draft, setDraft] = useState<Draft>(() => toDraft(targets, ids));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(toDraft(targets, data.accounts.map((a) => a.id)));
  }, [targets, data.accounts]);

  const allValid = Object.values(draft).every((d) => valid(d.targetCpa) && valid(d.targetRoas));
  const dirty = ids.some((id) => {
    const t = targetFor(targets, id);
    return Number(draft[id]?.targetCpa) !== t.targetCpa || Number(draft[id]?.targetRoas) !== t.targetRoas;
  });

  const save = () => {
    if (!allValid) return;
    const next: TargetsByAccount = { ...targets };
    for (const id of ids) next[id] = { targetCpa: Number(draft[id].targetCpa), targetRoas: Number(draft[id].targetRoas) };
    setTargets(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const input =
    'h-9 w-full rounded-lg border bg-white px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-900';

  return (
    <>
      <PageHeader title="Settings" subtitle="Goals drive health colours, alerts context and the recommendations engine. Stored in this browser (localStorage)." />

      <Card title="Account goals">
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
                      <span className="truncate">ID {a.id}</span>
                    </div>
                  </div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Target CPA ($)
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={d.targetCpa}
                      onChange={(e) => set('targetCpa', e.target.value)}
                      className={`${input} mt-1 ${valid(d.targetCpa) ? 'border-zinc-200 dark:border-zinc-700' : 'border-red-500'}`}
                    />
                  </label>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Target ROAS (x)
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.1"
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
            <button
              type="submit"
              disabled={!allValid || !dirty}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Save goals
            </button>
            <button
              type="button"
              onClick={resetTargets}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Reset to defaults
            </button>
            <span role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
              {saved ? 'Saved' : ''}
            </span>
            {!allValid && <span className="text-sm text-red-600">Goals must be positive numbers.</span>}
          </div>
        </form>
      </Card>

      <Card className="mt-4" title="Appearance">
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div>
            <div className="text-sm font-medium">Dark mode</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Follows your system the first time, then remembers your choice.</div>
          </div>
          <button
            role="switch"
            aria-checked={theme === 'dark'}
            aria-label="Dark mode"
            onClick={toggleTheme}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${theme === 'dark' ? 'bg-brand-500' : 'bg-zinc-300'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${theme === 'dark' ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
      </Card>

      <Card className="mt-4" title="Data source">
        <div className="px-4 py-4 text-sm text-zinc-600 dark:text-zinc-300">
          Using the seeded <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">MockDataSource</code> ({data.campaigns.length} campaigns, {data.creatives.length}{' '}
          creatives, data through {data.asOf}). Implement the <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">DataSource</code> interface in{' '}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">src/data/source.ts</code> to connect Meta, Google Ads and TikTok.
        </div>
      </Card>
    </>
  );
}
