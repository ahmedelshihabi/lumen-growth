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

type SortKey = 'name' | 'status' | 'budget' | 'spend' | 'revenue' | 'roas' | 'cpa' | 'ctr' | 'frequency' | 'health';

const HEALTH_ORDER: Record<Health, number> = { critical: 0, warning: 1, good: 2, inactive: 3 };

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
  const { data, rangeDays, targets } = useLoadedApp();
  const { t } = useI18n();
  const tr = t;
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState<'all' | Channel>('all');
  const [status, setStatus] = useState<'all' | CampaignStatus>('all');
  const [health, setHealth] = useState<'all' | Health>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'spend', dir: 'desc' });

  const summaries = useMemo(
    () => summarizeCampaigns(data.campaigns, data.campaignDaily, rangeEnding(data.asOf, rangeDays), targets),
    [data, rangeDays, targets],
  );

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

  return (
    <>
      <PageHeader
        title={t('nav.campaigns')}
        subtitle={t('campaigns.subtitle', { n: summaries.length, days: rangeDays })}
        actions={<RangePicker />}
      />

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

        <div className="overflow-x-auto">
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
                  <tr key={s.campaign.id} className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
                    <td className="max-w-[280px] py-2.5 ps-4 pe-3">
                      <div className="truncate font-medium text-zinc-900 dark:text-zinc-100" title={s.campaign.name}>
                        {s.campaign.name}
                      </div>
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
                      className={cx('px-3 py-2.5 text-end font-medium tabular-nums', active && !noValue && healthText(metricHealth(t.roas, s.target.targetRoas, true)))}
                      title={noValue ? tr('campaigns.noValue') : undefined}
                    >
                      {active && !noValue ? fmtRoas(t.roas) : active ? 'n/a' : '-'}
                    </td>
                    <td className={cx('px-3 py-2.5 text-end font-medium tabular-nums', active && healthText(metricHealth(t.cpa, s.target.targetCpa, false)))}>
                      {active && t.conversions > 0 ? fmtMoney2(t.cpa) : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{active ? fmtPct(t.ctr) : '-'}</td>
                    <td className={cx('px-3 py-2.5 text-end tabular-nums', s.frequency > 4 && 'font-medium text-red-600 dark:text-red-400')}>
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
          {rows.length === 0 && <EmptyState>{t('common.noMatch')}</EmptyState>}
        </div>
      </Card>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {t('campaigns.footnote')}
      </p>
    </>
  );
}
