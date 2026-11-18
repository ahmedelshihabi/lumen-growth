import { useMemo, useState } from 'react';
import { Card, ChannelBadge, EmptyState, PageHeader, StatCard, cx } from '../components/ui';
import { IconCheck } from '../components/icons';
import { useLoadedApp } from '../state/AppContext';
import { generateRecommendations, type Priority } from '../rules/recommendations';
import { fmtMoney } from '../lib/format';
import { formatShortDate } from '../lib/dates';
import type { Confidence } from '../rules/evaluate';
import { recKey } from '../rules/keys';
import { HiddenList, ItemActions } from '../components/ItemActions';
import { useI18n } from '../i18n';

const PRIORITY_STYLE: Record<Priority, string> = {
  high: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30',
  medium: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30',
  low: 'bg-zinc-100 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600/30',
};

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  medium: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  low: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
};

const IMPACT_STYLE = {
  revenue: 'text-emerald-700 dark:text-emerald-400',
  savings: 'text-sky-700 dark:text-sky-400',
  protect: 'text-zinc-800 dark:text-zinc-200',
};

export default function Recommendations() {
  const { rulesInput, isHidden } = useLoadedApp();
  const { t } = useI18n();
  const generated = useMemo(() => generateRecommendations(rulesInput), [rulesInput]);
  const recs = generated.filter((r) => !isHidden(recKey(r)));
  const hidden = generated.filter((r) => isHidden(recKey(r)));
  const [done, setDone] = useState<Set<string>>(new Set());

  const open = recs.filter((r) => !done.has(r.id));
  const sum = (k: 'revenue' | 'savings' | 'protect') => open.filter((r) => r.impact.kind === k).reduce((s, r) => s + r.impact.monthly, 0);

  const toggle = (id: string) =>
    setDone((d) => {
      const n = new Set(d);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title={t('nav.recommendations')}
        subtitle={t('recs.subtitle')}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('recs.open')} value={open.length} sub={t('recs.highPriority', { n: open.filter((r) => r.priority === 'high').length })} />
        <StatCard label={t('recs.revenueUpside')} value={fmtMoney(sum('revenue'))} tone="green" />
        <StatCard label={t('recs.savings')} value={fmtMoney(sum('savings'))} />
        <StatCard label={t('recs.atRisk')} value={fmtMoney(sum('protect'))} tone={sum('protect') > 0 ? 'amber' : undefined} />
      </div>

      <div className="mt-4 space-y-3">
        {recs.length === 0 && (
          <Card>
            <EmptyState>{t('recs.none')}</EmptyState>
          </Card>
        )}
        {recs.map((r) => {
          const isDone = done.has(r.id);
          return (
            <Card key={r.id} className={cx('p-4 transition-opacity', isDone && 'opacity-50')}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cx('rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset', PRIORITY_STYLE[r.priority])}>
                      {t(`priority.${r.priority}`)}
                    </span>
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t(`rec.${r.type}`)}</span>
                    {r.channels.map((c) => (
                      <ChannelBadge key={c} channel={c} />
                    ))}
                  </div>
                  <h3 dir="auto" className={cx('mt-1.5 text-[15px] font-semibold leading-snug', isDone && 'line-through')}>{t(r.titleMsg.key, r.titleMsg.vars)}</h3>
                  <p dir="auto" className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{t(r.rationaleMsg.key, r.rationaleMsg.vars)}</p>
                  {r.warningMsg && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                      ⚠️ {t(r.warningMsg.key, r.warningMsg.vars)}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span className={cx('rounded px-1.5 py-0.5 font-medium', CONFIDENCE_STYLE[r.confidence])}>{t(`recs.confidence.${r.confidence}`)}</span>
                    <span>{t('recs.basis', { days: r.window.activeDays, start: formatShortDate(r.window.start), end: formatShortDate(r.window.end) })}</span>
                  </div>
                  <ItemActions itemKey={recKey(r)} why={t(`why.${r.type}`)} />
                </div>
                <div className="flex items-center justify-between gap-4 sm:w-48 sm:flex-col sm:items-end sm:justify-start">
                  <div className="sm:text-end">
                    <div className={cx('text-lg font-semibold tabular-nums', IMPACT_STYLE[r.impact.kind])}>
                      {r.impact.kind === 'revenue' ? '+' : ''}
                      {fmtMoney(r.impact.monthly)}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{t(r.impact.labelMsg.key, r.impact.labelMsg.vars)}</div>
                  </div>
                  <button
                    onClick={() => toggle(r.id)}
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium',
                      isDone
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
                    )}
                  >
                    <IconCheck width={14} height={14} />
                    {isDone ? t('recs.done') : t('recs.markDone')}
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <HiddenList items={hidden.map((r) => ({ key: recKey(r), title: t(r.titleMsg.key, r.titleMsg.vars) }))} />
    </>
  );
}
