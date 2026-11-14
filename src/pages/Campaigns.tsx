import { useMemo, useState } from 'react';
import { Card, ChannelBadge, EmptyState, HealthPill, PageHeader, RangePicker, Select, StatusBadge, cx, healthText } from '../components/ui';
import { IconArrowDown, IconArrowUp, IconSort } from '../components/icons';
import { useLoadedApp } from '../state/AppContext';
import { rangeEnding } from '../lib/metrics';
import { fmtMoney, fmtMoney2, fmtPct, fmtRoas } from '../lib/format';
import { summarizeCampaigns, type CampaignSummary } from '../rules/summary';
import { metricHealth, type Health } from '../rules/health';
import type { CampaignStatus, Channel } from '../data/types';

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

const COLUMNS: { key: SortKey; label: string; align?: 'right'; className?: string }[] = [
  { key: 'name', label: 'Campaign' },
  { key: 'status', label: 'Status' },
  { key: 'budget', label: 'Budget/day', align: 'right' },
  { key: 'spend', label: 'Spend', align: 'right' },
  { key: 'revenue', label: 'Revenue', align: 'right' },
  { key: 'roas', label: 'ROAS', align: 'right' },
  { key: 'cpa', label: 'CPA', align: 'right' },
  { key: 'ctr', label: 'CTR', align: 'right' },
  { key: 'frequency', label: 'Freq.', align: 'right' },
  { key: 'health', label: 'Health' },
];

export default function Campaigns() {
  const { data, rangeDays, targets } = useLoadedApp();
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
        title="Campaigns"
        subtitle={`${summaries.length} campaigns across Meta, Google and TikTok · last ${rangeDays} days · health vs account goals`}
        actions={<RangePicker />}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 p-3 dark:border-zinc-800">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search campaigns"
            aria-label="Search campaigns"
            className="h-9 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-zinc-700 dark:bg-zinc-900 sm:w-64"
          />
          <Select
            label="Channel"
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'all', label: 'All channels' },
              { value: 'meta', label: 'Meta' },
              { value: 'google', label: 'Google' },
              { value: 'tiktok', label: 'TikTok' },
            ]}
          />
          <Select
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'Any status' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'LEARNING', label: 'Learning' },
              { value: 'PAUSED', label: 'Paused' },
            ]}
          />
          <Select
            label="Health"
            value={health}
            onChange={setHealth}
            options={[
              { value: 'all', label: 'Any health' },
              { value: 'good', label: 'On target' },
              { value: 'warning', label: 'Near target' },
              { value: 'critical', label: 'Off target' },
              { value: 'inactive', label: 'No delivery' },
            ]}
          />
          <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">{rows.length} shown</span>
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
                      className={cx('px-3 py-2.5 font-medium', c.align === 'right' ? 'text-right' : 'text-left', c.key === 'name' && 'pl-4')}
                    >
                      <button
                        onClick={() => toggleSort(c.key)}
                        className={cx('inline-flex items-center gap-1 uppercase hover:text-zinc-900 dark:hover:text-zinc-100', active && 'text-zinc-900 dark:text-zinc-100')}
                      >
                        {c.label}
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
                return (
                  <tr key={s.campaign.id} className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
                    <td className="max-w-[280px] py-2.5 pl-4 pr-3">
                      <div className="truncate font-medium text-zinc-900 dark:text-zinc-100" title={s.campaign.name}>
                        {s.campaign.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <ChannelBadge channel={s.campaign.channel} />
                        <span className="text-[11px] text-zinc-400">{s.campaign.objective.toLowerCase()}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={s.campaign.status} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(s.campaign.dailyBudget)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(t.spend)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(t.revenue)}</td>
                    <td className={cx('px-3 py-2.5 text-right font-medium tabular-nums', active && healthText(metricHealth(t.roas, s.target.targetRoas, true)))}>
                      {active ? fmtRoas(t.roas) : '-'}
                    </td>
                    <td className={cx('px-3 py-2.5 text-right font-medium tabular-nums', active && healthText(metricHealth(t.cpa, s.target.targetCpa, false)))}>
                      {active && t.conversions > 0 ? fmtMoney2(t.cpa) : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{active ? fmtPct(t.ctr) : '-'}</td>
                    <td className={cx('px-3 py-2.5 text-right tabular-nums', s.frequency > 4 && 'font-medium text-red-600 dark:text-red-400')}>
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
          {rows.length === 0 && <EmptyState>No campaigns match these filters.</EmptyState>}
        </div>
      </Card>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        ROAS and CPA are coloured against the goals in Settings: green on goal, amber within 20%, red beyond. Frequency above 4 is flagged.
      </p>
    </>
  );
}
