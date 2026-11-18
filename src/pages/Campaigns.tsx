import { useMemo, useState } from 'react';
import { Card, ChannelBadge, EmptyState, HealthPill, PageHeader, RangePicker, Select, StatusBadge, cx, healthText } from '../components/ui';
import { IconArrowDown, IconArrowUp, IconSort } from '../components/icons';
import { useLoadedApp } from '../state/AppContext';
import { rangeEnding } from '../lib/metrics';
import { fmtMoney, fmtMoney2, fmtPct, fmtRoas } from '../lib/format';
import { summarizeCampaigns, type CampaignSummary } from '../rules/summary';
import { lacksValueTracking, metricHealth, type Health } from '../rules/health';
import type { CampaignStatus, Channel } from '../data/types';
import { useI18n } from '../i18n';
import type { DictKey } from '../i18n/dict';
import CampaignDetail from '../components/CampaignDetail';
import { downloadCsv } from '../lib/csv';

type SortKey = 'name' | 'status' | 'budget' | 'spend' | 'revenue' | 'roas' | 'cpa' | 'ctr' | 'frequency' | 'health';

const HEALTH_ORDER: Record<Health, number> = { critical: 0, warning: 1, unrated: 2, good: 3, inactive: 4 };

const value = (s: CampaignSummary, k: SortKey): number | string => {
  switch (k) {
    case 'name':
      return s.campaign.name.toLowerCase();
    case 'status':
      return s.campaign.status;
    case 'budget':
      return s.campaign.dailyBudget;
    case 'spend':
      return s.totals.spend;
    case 'revenue':
      return s.totals.revenue;
    case 'roas':
      return s.totals.roas;
    case 'cpa':
      return s.totals.conversions > 0 ? s.totals.cpa : Number.POSITIVE_INFINITY;
    case 'ctr':
      return s.totals.ctr;
    case 'frequency':
      return s.frequency;
    case 'health':
      return HEALTH_ORDER[s.health];
  }
};

const COLUMNS: { key: SortKey; label: DictKey; align?: 'right'; className?: string }[] = [
  { key: 'name', label: 'campaigns.col.name' },
  { key: 'status', label: 'common.status' },
  { key: 'budget', label: 'campaigns.col.budget', align: 'right' },
  { key: 'spend', label: 'common.spend', align: 'right' },
  { key: 'revenue', label: 'common.revenue', align: 'right' },
  { key: 'roas', label: 'metric.roas', align: 'right' },
  { key: 'cpa', label: 'metric.cpa', align: 'right' },
  { key: 'ctr', label: 'metric.ctr', align: 'right' },
  { key: 'frequency', label: 'campaigns.col.freq', align: 'right' },
  { key: 'health', label: 'campaigns.col.health' },
];

export default function Campaigns() {
  const { data, rangeDays, targets, rulesInput } = useLoadedApp();
  const { t } = useI18n();
  const tr = t;
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState<'all' | Channel>('all');
  const [status, setStatus] = useState<'all' | CampaignStatus>('all');
  const [health, setHealth] = useState<'all' | Health>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'spend', dir: 'desc' });

  const summaries = useMemo(
    () => summarizeCampaigns(data.campaigns, data.campaignDaily, rangeEnding(data.asOf, rangeDays), targets, rulesInput.evalConfig),
    [data, rangeDays, targets, rulesInput.evalConfig],
  );

  const [openId, setOpenId] = useState<string | null>(null);
  const range = useMemo(() => rangeEnding(data.asOf, rangeDays), [data.asOf, rangeDays]);
  const open = summaries.find((s) => s.campaign.id === openId) ?? null;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = summaries.filter(
      (s) =>
        (channel === 'all' || s.campaign.channel === channel) &&
        (status === 'all' || s.campaign.status === status) &&
        (health === 'all' || s.health === health) &&
        (!q || s.campaign.name.toLowerCase().includes(q)),
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.campaign.name.localeCompare(b.campaign.name);
    });
  }, [summaries, query, channel, status, health, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'cpa' || key === 'health' ? 'asc' : 'desc' }));


  // Exports exactly what the table shows (filters and sort applied).
  const exportCampaigns = () =>
    downloadCsv(
      `lumen-campaigns-${range.start}_${range.end}.csv`,
      ['campaign', 'channel', 'objective', 'judged_on', 'status', 'daily_budget', 'spend', 'revenue', 'roas', 'conversions', 'cpa', 'ctr_pct', 'frequency', 'health', 'vs_goal_pct'],
      rows.map((s) => [
        s.campaign.name,
        s.campaign.channel,
        s.campaign.objective,
        s.kind,
        s.campaign.status,
        s.campaign.dailyBudget,
        s.totals.spend,
        s.totals.revenue,
        s.totals.spend > 0 && s.kind === 'sales' ? s.totals.roas : null,
        s.totals.conversions,
        s.totals.conversions > 0 ? s.totals.cpa : null,
        s.totals.ctr * 100,
        s.frequency,
        s.health,
        s.ratio === null ? null : s.ratio * 100,
      ]),
    );

  return (
    <>
      <PageHeader
        title={t('nav.campaigns')}
        subtitle={t('campaigns.subtitle', { n: summaries.length, days: rangeDays })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportCampaigns}
              disabled={!rows.length}
              className="h-9 rounded-full border border-zinc-200 px-3 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {t('common.exportCsv')}
            </button>
            <RangePicker />
          </div>
        }
      />
      {open && <CampaignDetail summary={open} range={range} onClose={() => setOpenId(null)} />}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 p-3 dark:border-zinc-800">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('campaigns.search')}
            aria-label={t('campaigns.search')}
            className="h-9 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-zinc-700 dark:bg-zinc-900 sm:w-64"
          />
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
            label={t('common.status')}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: t('campaigns.anyStatus') },
              { value: 'ACTIVE', label: t('status.ACTIVE') },
              { value: 'LEARNING', label: t('status.LEARNING') },
              { value: 'PAUSED', label: t('status.PAUSED') },
            ]}
          />
          <Select
            label={t('campaigns.col.health')}
            value={health}
            onChange={setHealth}
            options={[
              { value: 'all', label: t('campaigns.anyHealth') },
              { value: 'good', label: t('health.good') },
              { value: 'warning', label: t('health.warning') },
              { value: 'critical', label: t('health.critical') },
              { value: 'inactive', label: t('health.inactive') },
            ]}
          />
          <span className="ms-auto text-xs text-zinc-500 dark:text-zinc-400">{t('common.shown', { n: rows.length })}</span>
        </div>

        {/* Phones: one card per campaign with every metric visible (no sideways scrolling). */}
        <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800">
          {rows.map((s) => {
            const m = s.totals;
            const active = m.spend > 0;
            const noValue = lacksValueTracking(m);
            const cell = (label: string, value: string, cls?: string) => (
              <div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
                <div className={cx('text-sm font-medium tabular-nums', cls)}>{value}</div>
              </div>
            );
            return (
              <li key={s.campaign.id} className="cursor-pointer px-4 py-3 active:bg-brand-50 dark:active:bg-brand-500/10" onClick={() => setOpenId(s.campaign.id)}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={s.campaign.name}>
                      <bdi>{s.campaign.name}</bdi>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <ChannelBadge channel={s.campaign.channel} />
                      <StatusBadge status={s.campaign.status} />
                    </div>
                  </div>
                  <HealthPill health={s.health} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                  {cell(t('common.spend'), fmtMoney(m.spend))}
                  {cell(t('common.revenue'), fmtMoney(m.revenue))}
                  {cell(
                    t('metric.roas'),
                    active && !noValue ? fmtRoas(m.roas) : active ? 'n/a' : '-',
                    active && s.kind === 'sales' ? healthText(metricHealth(m.roas, s.target.targetRoas, true)) : undefined,
                  )}
                  {cell(
                    t('metric.cpa'),
                    active && m.conversions > 0 ? fmtMoney2(m.cpa) : '-',
                    active && m.conversions > 0 && (s.kind === 'sales' || s.kind === 'leads') ? healthText(metricHealth(m.cpa, s.target.targetCpa, false)) : undefined,
                  )}
                  {cell(t('metric.ctr'), active ? fmtPct(m.ctr) : '-')}
                  {cell(t('campaigns.col.freq'), active ? s.frequency.toFixed(1) : '-', s.frequencyOverCap ? 'text-red-600 dark:text-red-400' : undefined)}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={cx('px-3 py-2.5 font-medium', c.align === 'right' ? 'text-end' : 'text-start', c.key === 'name' && 'ps-4')}
                    >
                      <button
                        onClick={() => toggleSort(c.key)}
                        className={cx('inline-flex items-center gap-1 uppercase hover:text-zinc-900 dark:hover:text-zinc-100', active && 'text-zinc-900 dark:text-zinc-100')}
                      >
                        {t(c.label)}
                        {active ? sort.dir === 'asc' ? <IconArrowUp /> : <IconArrowDown /> : <IconSort className="opacity-40" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const t = s.totals;
                const active = t.spend > 0;
                const noValue = lacksValueTracking(t);
                return (
                  <tr
                    key={s.campaign.id}
                    onClick={() => setOpenId(s.campaign.id)}
                    className="cursor-pointer border-t border-zinc-100 hover:bg-brand-50/60 dark:border-zinc-800 dark:hover:bg-brand-500/10"
                  >
                    <td className="max-w-[280px] py-2.5 ps-4 pe-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(s.campaign.id);
                        }}
                        className="block max-w-full truncate text-start font-medium text-zinc-900 hover:text-brand-700 hover:underline dark:text-zinc-100 dark:hover:text-brand-300"
                        title={s.campaign.name}
                      >
                        <bdi>{s.campaign.name}</bdi>
                      </button>
                      <div className="mt-0.5 flex items-center gap-2">
                        <ChannelBadge channel={s.campaign.channel} />
                        <span className="text-[11px] text-zinc-400">{s.campaign.objective.toLowerCase()}</span>
                        {t.conversations > 0 && (
                          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400" dir="auto">
                            {tr('campaigns.perConversation', { cost: fmtMoney2(t.costPerConversation) })}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={s.campaign.status} />
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{fmtMoney(s.campaign.dailyBudget)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{fmtMoney(t.spend)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{fmtMoney(t.revenue)}</td>
                    <td
                      className={cx('px-3 py-2.5 text-end font-medium tabular-nums', active && s.kind === 'sales' && healthText(metricHealth(t.roas, s.target.targetRoas, true)))}
                      title={noValue ? tr('campaigns.noValue') : undefined}
                    >
                      {active && !noValue ? fmtRoas(t.roas) : active ? 'n/a' : '-'}
                    </td>
                    <td className={cx('px-3 py-2.5 text-end font-medium tabular-nums', active && (s.kind === 'sales' || s.kind === 'leads') && healthText(metricHealth(t.cpa, s.target.targetCpa, false)))}>
                      {active && t.conversions > 0 ? fmtMoney2(t.cpa) : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{active ? fmtPct(t.ctr) : '-'}</td>
                    <td className={cx('px-3 py-2.5 text-end tabular-nums', s.frequencyOverCap && 'font-medium text-red-600 dark:text-red-400')}>
                      {active ? s.frequency.toFixed(1) : '-'}
                    </td>
                    <td className="px-3 py-2.5">
                      <HealthPill health={s.health} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <EmptyState>{t('common.noMatch')}</EmptyState>}
      </Card>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {t('campaigns.footnote')}
      </p>
    </>
  );
}
