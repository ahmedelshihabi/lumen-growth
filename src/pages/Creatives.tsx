import { useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { Card, ChannelBadge, EmptyState, PageHeader, RangePicker, Select, cx, healthText } from '../components/ui';
import { IconPlay } from '../components/icons';
import { useLoadedApp } from '../state/AppContext';
import { useI18n } from '../i18n';
import { aggregate, filterRange, groupBy, rangeEnding, safeDiv } from '../lib/metrics';
import { addDays } from '../lib/dates';
import { fmtMoney, fmtMoney2, fmtPct, fmtSignedPct } from '../lib/format';
import { detectFatigue, type FatigueStatus } from '../rules/fatigue';
import { metricHealth } from '../rules/health';
import { targetFor } from '../rules/types';
import type { Channel, Creative } from '../data/types';

const FATIGUE: Record<FatigueStatus, { cls: string }> = {
  fatigued: { cls: 'bg-red-600 text-white' },
  watch: { cls: 'bg-amber-400 text-amber-950' },
  healthy: { cls: 'bg-emerald-600 text-white' },
  insufficient: { cls: 'bg-zinc-600 text-white' },
};

type SortKey = 'spend' | 'cpa' | 'ctr' | 'hook' | 'fatigue';
const FATIGUE_RANK: Record<FatigueStatus, number> = { fatigued: 0, watch: 1, healthy: 2, insufficient: 3 };

function Tile({ c }: { c: Creative }) {
  return (
    <div
      className="relative aspect-[4/3] overflow-hidden rounded-t-xl"
      style={{ background: `linear-gradient(135deg, ${c.color} 0%, ${c.color}cc 45%, #0b0b0f 140%)` }}
      aria-hidden
    >
      <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_20%_20%,#fff_0,transparent_45%)]" />
      <span className="absolute start-3 top-3 rounded bg-black/35 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">
        {c.format}
      </span>
      {c.format === 'video' && (
        <span className="absolute end-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white/85 text-zinc-900">
          <IconPlay width={14} height={14} />
        </span>
      )}
      <p className="absolute inset-x-3 bottom-3 line-clamp-2 text-[15px] font-semibold leading-snug text-white drop-shadow">{c.headline}</p>
    </div>
  );
}

export default function Creatives() {
  const { data, rangeDays, targets, theme } = useLoadedApp();
  const { t: tr } = useI18n();
  const t = tr;
  const [channel, setChannel] = useState<'all' | Channel>('all');
  const [fatigue, setFatigue] = useState<'all' | FatigueStatus>('all');
  const [sort, setSort] = useState<SortKey>('fatigue');

  const cards = useMemo(() => {
    const range = rangeEnding(data.asOf, rangeDays);
    const rowsBy = groupBy(data.creativeDaily, (r) => r.creativeId);
    const campaigns = new Map(data.campaigns.map((c) => [c.id, c]));
    const sparkStart = addDays(data.asOf, -20);
    return data.creatives.map((c) => {
      const all = rowsBy[c.id] ?? [];
      const inRange = filterRange(all, range);
      const t = aggregate(inRange);
      const views = inRange.reduce((s, r) => s + r.videoViews3s, 0);
      const campaign = campaigns.get(c.campaignId)!;
      // CTR and frequency indexed to their first day (=100) so both share one scale
      const recent = all.filter((r) => r.date >= sparkStart);
      const ctr0 = safeDiv(recent[0]?.clicks ?? 0, recent[0]?.impressions ?? 0);
      const freq0 = recent[0]?.frequency ?? 0;
      const spark = recent.map((r) => ({
        date: r.date,
        ctr: safeDiv(safeDiv(r.clicks, r.impressions), ctr0) * 100,
        freq: safeDiv(r.frequency, freq0) * 100,
      }));
      return {
        creative: c,
        campaign,
        totals: t,
        hookRate: c.format === 'video' ? safeDiv(views, t.impressions) : null,
        fatigue: detectFatigue(all, data.asOf),
        target: targetFor(targets, campaign.accountId),
        spark,
      };
    });
  }, [data, rangeDays, targets]);

  const shown = useMemo(() => {
    const list = cards.filter(
      (c) => (channel === 'all' || c.creative.channel === channel) && (fatigue === 'all' || c.fatigue.status === fatigue) && c.totals.spend > 0,
    );
    const key = (c: (typeof cards)[number]): number => {
      switch (sort) {
        case 'spend':
          return -c.totals.spend;
        case 'cpa':
          return c.totals.conversions ? c.totals.cpa : Infinity;
        case 'ctr':
          return -c.totals.ctr;
        case 'hook':
          return -(c.hookRate ?? -1);
        case 'fatigue':
          return FATIGUE_RANK[c.fatigue.status] * 1e9 - c.totals.spend;
      }
    };
    return list.sort((a, b) => key(a) - key(b));
  }, [cards, channel, fatigue, sort]);

  const counts = cards.reduce<Record<string, number>>((acc, c) => ((acc[c.fatigue.status] = (acc[c.fatigue.status] ?? 0) + 1), acc), {});
  const lineColor = theme === 'dark' ? '#9085e9' : '#6250d6';
  const freqColor = theme === 'dark' ? '#8b8b86' : '#9a9a96';

  return (
    <>
      <PageHeader
        title={t('creatives.title')}
        subtitle={`${t('creatives.subtitle', { n: cards.filter((c) => c.totals.spend > 0).length, days: rangeDays })} · ${t('fatigue.fatigued')} ${counts.fatigued ?? 0} · ${t('fatigue.watch')} ${counts.watch ?? 0}`}
        actions={<RangePicker />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          label={t('common.channel')}
          value={channel}
          onChange={setChannel}
          options={[
            { value: 'all', label: t('common.allChannels') },
            { value: 'meta', label: 'Meta' },
            { value: 'google', label: 'Google' },
            { value: 'tiktok', label: 'TikTok' },
          ]}
        />
        <Select
          label={t('creatives.anyFatigue')}
          value={fatigue}
          onChange={setFatigue}
          options={[
            { value: 'all', label: t('creatives.anyFatigue') },
            { value: 'fatigued', label: t('fatigue.fatigued') },
            { value: 'watch', label: t('fatigue.watch') },
            { value: 'healthy', label: t('fatigue.healthy') },
          ]}
        />
        <Select
          label={t('creatives.sortBy')}
          value={sort}
          onChange={setSort}
          options={[
            { value: 'fatigue', label: t('creatives.sort.fatigue') },
            { value: 'spend', label: t('creatives.sort.spend') },
            { value: 'cpa', label: t('creatives.sort.cpa') },
            { value: 'ctr', label: t('creatives.sort.ctr') },
            { value: 'hook', label: t('creatives.sort.hook') },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState>{t('common.noMatch')}</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map(({ creative: c, campaign, totals: t, hookRate, fatigue: f, target, spark }) => (
            <Card key={c.id} className="flex flex-col overflow-hidden">
              <div className="relative">
                <Tile c={c} />
                <span className={cx('absolute bottom-3 end-3 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow', FATIGUE[f.status].cls)}>
                  {tr(`fatigue.${f.status}`)}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="truncate text-sm font-semibold" title={c.name}>
                  {c.name}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-2">
                  <ChannelBadge channel={c.channel} />
                  <span className="truncate text-[11px] text-zinc-400" title={campaign.name}>
                    {campaign.name}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-zinc-50 py-2 dark:bg-zinc-800/60">
                    <dt className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{tr('creatives.hook')}</dt>
                    <dd className="text-sm font-semibold tabular-nums">{hookRate === null ? '-' : fmtPct(hookRate, 1)}</dd>
                  </div>
                  <div className="rounded-lg bg-zinc-50 py-2 dark:bg-zinc-800/60">
                    <dt className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">CTR</dt>
                    <dd className="text-sm font-semibold tabular-nums">{fmtPct(t.ctr)}</dd>
                  </div>
                  <div className="rounded-lg bg-zinc-50 py-2 dark:bg-zinc-800/60">
                    <dt className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">CPA</dt>
                    <dd className={cx('text-sm font-semibold tabular-nums', healthText(metricHealth(t.cpa, target.targetCpa, false)))}>
                      {t.conversions ? fmtMoney2(t.cpa) : '-'}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{tr('common.spend')} {fmtMoney(t.spend)}</span>
                  <span>{tr('creatives.freq', { v: f.recentFrequency > 0 ? f.recentFrequency.toFixed(1) : '-' })}</span>
                </div>

                <div className="mt-2 h-12" aria-label="CTR (solid) and frequency (dashed), indexed to 21 days ago" role="img" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={spark} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
                      <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
                      <Line type="monotone" dataKey="freq" stroke={freqColor} strokeWidth={1.5} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="ctr" stroke={lineColor} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-1 flex justify-between text-[11px] tabular-nums">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    <span className="me-1 inline-block h-0.5 w-3 align-middle" style={{ background: lineColor }} />
                    {tr('creatives.ctrWow')}{' '}
                    <span className={f.ctrChange <= -0.15 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'}>
                      {fmtSignedPct(f.ctrChange, 0)}
                    </span>
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    <span className="me-1 inline-block w-3 border-t-2 border-dashed align-middle" style={{ borderColor: freqColor }} />
                    {tr('creatives.freqWow')}{' '}
                    <span className={f.frequencyChange >= 0.15 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'}>
                      {fmtSignedPct(f.frequencyChange, 0)}
                    </span>
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
