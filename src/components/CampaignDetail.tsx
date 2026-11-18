import { useEffect, useMemo, useRef } from 'react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChannelBadge, HealthPill, StatusBadge, cx } from './ui';
import { ChartTooltip } from './ChartTooltip';
import { useLoadedApp } from '../state/AppContext';
import { useI18n } from '../i18n';
import { aggregate, filterRange, groupBy, safeDiv } from '../lib/metrics';
import { addDays, formatShortDate } from '../lib/dates';
import { chartColors } from '../lib/colors';
import { fmtMoney, fmtMoney2, fmtMoneyCompact, fmtPct, fmtRoas } from '../lib/format';
import { downloadCsv } from '../lib/csv';
import { detectFatigue, type FatigueStatus } from '../rules/fatigue';
import type { CampaignSummary } from '../rules/summary';
import type { DateRange } from '../data/types';

const FATIGUE_CLS: Record<FatigueStatus, string> = {
  poor: 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900',
  fatigued: 'bg-red-600 text-white',
  watch: 'bg-amber-500 text-white',
  healthy: 'bg-emerald-600 text-white',
  insufficient: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
};

/** Side panel: one campaign's daily trend, totals and ads. Opens from the Campaigns table. */
export default function CampaignDetail({ summary, range, onClose }: { summary: CampaignSummary; range: DateRange; onClose: () => void }) {
  const { data, theme } = useLoadedApp();
  const { t } = useI18n();
  const colors = chartColors(theme);
  const c = summary.campaign;
  const m = summary.totals;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const days = useMemo(() => {
    const rows = filterRange(data.campaignDaily, range).filter((r) => r.campaignId === c.id);
    const byDate = groupBy(rows, (r) => r.date);
    const n = Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86400000) + 1;
    return Array.from({ length: n }, (_, i) => {
      const date = addDays(range.start, i);
      const a = aggregate(byDate[date] ?? []);
      return { date, spend: a.spend, revenue: a.revenue, roas: a.spend > 0 ? a.roas : null };
    });
  }, [data, range, c.id]);

  const ads = useMemo(() => {
    const judgeOnCpa = c.objective === 'SALES' || c.objective === 'LEADS';
    const byAd = groupBy(data.creativeDaily, (r) => r.creativeId);
    return data.creatives
      .filter((cr) => cr.campaignId === c.id)
      .map((cr) => {
        const all = byAd[cr.id] ?? [];
        const tot = aggregate(filterRange(all, range));
        const views = filterRange(all, range).reduce((s, r) => s + r.videoViews3s, 0);
        return {
          cr,
          tot,
          hook: cr.format === 'video' ? safeDiv(views, tot.impressions) : null,
          fatigue: detectFatigue(all, data.asOf, undefined, judgeOnCpa ? summary.target : undefined).status,
        };
      })
      .filter((a) => a.tot.spend > 0)
      .sort((a, b) => b.tot.spend - a.tot.spend);
  }, [data, range, c, summary.target]);

  const exportAds = () =>
    downloadCsv(
      `lumen-${c.name.replace(/[^\w؀-ۿ-]+/g, '-').slice(0, 40)}-ads-${range.start}_${range.end}.csv`,
      ['ad', 'format', 'spend', 'revenue', 'roas', 'conversions', 'cpa', 'ctr_pct', 'hook_rate_pct', 'status'],
      ads.map((a) => [
        a.cr.name,
        a.cr.format,
        a.tot.spend,
        a.tot.revenue,
        a.tot.spend > 0 ? a.tot.roas : null,
        a.tot.conversions,
        a.tot.conversions > 0 ? a.tot.cpa : null,
        a.tot.ctr * 100,
        a.hook === null ? null : a.hook * 100,
        a.fatigue,
      ]),
    );

  const tile = (label: string, value: string) => (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">
        <bdi>{value}</bdi>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby="campaign-detail-title">
      <button type="button" aria-label={t('common.close')} className="hidden flex-1 bg-zinc-950/40 backdrop-blur-[1px] md:block" onClick={onClose} />
      <div className="flex h-full w-full flex-col overflow-y-auto bg-white shadow-2xl md:w-[720px] dark:bg-zinc-900">
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-zinc-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
          <div className="min-w-0 flex-1">
            <h2 id="campaign-detail-title" className="truncate text-lg font-bold" title={c.name}>
              <bdi>{c.name}</bdi>
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <ChannelBadge channel={c.channel} />
              <StatusBadge status={c.status} />
              <HealthPill health={summary.health} />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {t(`kind.${summary.kind}`)} · {formatShortDate(range.start)} – {formatShortDate(range.end)}
              </span>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-zinc-200 text-lg leading-none hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-4">
          {tile(t('common.spend'), fmtMoney(m.spend))}
          {tile(t('common.revenue'), fmtMoney(m.revenue))}
          {tile(t('metric.roas'), m.spend > 0 && summary.kind === 'sales' ? fmtRoas(m.roas) : '-')}
          {tile(t('metric.cpa'), m.conversions > 0 ? fmtMoney2(m.cpa) : '-')}
          {tile(t('common.conversions'), String(Math.round(m.conversions)))}
          {tile(t('metric.ctr'), fmtPct(m.ctr))}
          {tile(t('campaigns.col.freq'), `${summary.frequency.toFixed(1)} / ${summary.frequencyCap}`)}
          {tile(t('detail.cpm'), fmtMoney2(m.cpm))}
        </div>

        <div className="px-5">
          <h3 className="text-sm font-semibold">{t('detail.daily')}</h3>
          {/* Time axis stays left-to-right in both languages. */}
          <div className="mt-2 h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={colors.grid} />
                <XAxis dataKey="date" tickFormatter={formatShortDate} interval="preserveStartEnd" minTickGap={28} tick={{ fill: colors.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="money" tickFormatter={fmtMoneyCompact} tick={{ fill: colors.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
                <YAxis yAxisId="roas" orientation="right" tickFormatter={(v: number) => `${v}x`} tick={{ fill: colors.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={36} hide={summary.kind !== 'sales'} />
                <Tooltip
                  content={<ChartTooltip formatLabel={formatShortDate} formatValue={(v, name) => (name === t('metric.roas') ? `${v.toFixed(2)}x` : fmtMoney(v))} />}
                  cursor={{ stroke: colors.axis, strokeDasharray: '3 3' }}
                />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                <Area yAxisId="money" type="monotone" dataKey="revenue" name={t('common.revenue')} stroke={colors.revenue} fill={colors.revenue} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
                <Area yAxisId="money" type="monotone" dataKey="spend" name={t('common.spend')} stroke={colors.spend} fill={colors.spend} fillOpacity={0.1} strokeWidth={2} isAnimationActive={false} />
                {summary.kind === 'sales' && (
                  <Line yAxisId="roas" type="monotone" dataKey="roas" name={t('metric.roas')} stroke="#F56CCB" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="mt-6 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between px-5 py-3">
            <h3 className="text-sm font-semibold">{t('detail.ads', { n: ads.length })}</h3>
            <button
              type="button"
              onClick={exportAds}
              disabled={!ads.length}
              className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {t('common.exportCsv')}
            </button>
          </div>
          {ads.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-zinc-500">{t('detail.noAds')}</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {ads.map(({ cr, tot, hook, fatigue }) => (
                <li key={cr.id} className="px-5 py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" title={cr.name}>
                        <bdi>{cr.name}</bdi>
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{t(`format.${cr.format}`)}</div>
                    </div>
                    <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', FATIGUE_CLS[fatigue])}>{t(`fatigue.${fatigue}`)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
                    {[
                      [t('common.spend'), fmtMoney(tot.spend)],
                      [t('common.revenue'), fmtMoney(tot.revenue)],
                      [t('metric.roas'), summary.kind === 'sales' ? fmtRoas(tot.roas) : '-'],
                      [t('metric.cpa'), tot.conversions > 0 ? fmtMoney2(tot.cpa) : '-'],
                      [t('metric.ctr'), fmtPct(tot.ctr)],
                      [t('detail.hook'), hook === null ? '-' : fmtPct(hook, 0)],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div className="text-zinc-500 dark:text-zinc-400">{k}</div>
                        <div className="font-medium tabular-nums">{v}</div>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
