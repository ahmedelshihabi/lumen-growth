import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, ChannelBadge, Delta, PageHeader, RangePicker, SeverityBadge } from '../components/ui';
import { ChartTooltip } from '../components/ChartTooltip';
import { useLoadedApp } from '../state/AppContext';
import { aggregate, filterRange, groupBy, pctChange, previousRange, rangeEnding, type Totals } from '../lib/metrics';
import { addDays, formatShortDate } from '../lib/dates';
import { fmtCompact, fmtMoney, fmtMoney2, fmtMoneyCompact, fmtPct, fmtRoas } from '../lib/format';
import { CHANNEL_LABEL, chartColors, channelColor } from '../lib/colors';
import { detectAnomalies } from '../rules/anomalies';
import type { Channel } from '../data/types';
import { Link } from '../lib/router';
import { useI18n } from '../i18n';
import type { DictKey } from '../i18n/dict';
import { getDisplayCurrency } from '../lib/format';

interface Kpi {
  key: keyof Totals;
  label: DictKey;
  format: (n: number) => string;
  goodWhenUp: boolean | null;
}

const KPIS: Kpi[] = [
  { key: 'spend', label: 'common.spend', format: fmtMoney, goodWhenUp: null },
  { key: 'revenue', label: 'common.revenue', format: fmtMoney, goodWhenUp: true },
  { key: 'roas', label: 'metric.roas', format: fmtRoas, goodWhenUp: true },
  { key: 'cpa', label: 'metric.cpa', format: fmtMoney2, goodWhenUp: false },
  { key: 'ctr', label: 'metric.ctr', format: (n) => fmtPct(n), goodWhenUp: true },
  { key: 'conversions', label: 'common.conversions', format: (n) => fmtCompact(Math.round(n)), goodWhenUp: true },
];

const CHANNELS: Channel[] = ['meta', 'google', 'tiktok'];

export default function Overview() {
  const { data, rangeDays, theme, rulesInput } = useLoadedApp();
  const { t } = useI18n();
  const colors = chartColors(theme);

  const model = useMemo(() => {
    const range = rangeEnding(data.asOf, rangeDays);
    const prev = previousRange(range, rangeDays);
    const rows = filterRange(data.campaignDaily, range);
    const current = aggregate(rows);
    const previous = aggregate(filterRange(data.campaignDaily, prev));

    const byDate = groupBy(rows, (r) => r.date);
    const daily = Array.from({ length: rangeDays }, (_, i) => {
      const date = addDays(range.start, i);
      const t = aggregate(byDate[date] ?? []);
      return { date, ...t };
    });

    const channelOf = new Map(data.campaigns.map((c) => [c.id, c.channel]));
    const byChannel = groupBy(rows, (r) => channelOf.get(r.campaignId) ?? 'meta');
    const channels = CHANNELS.map((ch) => ({ channel: ch, name: CHANNEL_LABEL[ch], ...aggregate(byChannel[ch] ?? []) }));

    return { range, current, previous, daily, channels };
  }, [data, rangeDays]);

  const alerts = useMemo(() => detectAnomalies(rulesInput).slice(0, 4), [rulesInput]);
  const totalSpend = model.current.spend;

  return (
    <>
      <PageHeader
        title={t('nav.overview')}
        subtitle={t('overview.subtitle', { start: formatShortDate(model.range.start), end: formatShortDate(model.range.end), n: rangeDays })}
        actions={<RangePicker />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {KPIS.map((k) => (
          <Card key={k.key} className="p-4">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t(k.label)}</div>
            <div className="mt-1 truncate text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50 sm:text-2xl">
              {k.format(model.current[k.key])}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <Delta value={pctChange(model.current[k.key], model.previous[k.key])} goodWhenUp={k.goodWhenUp} />
              <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">{t('overview.vs', { value: k.format(model.previous[k.key]) })}</span>
            </div>
            <div className="mt-2 h-8" aria-hidden dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={model.daily} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
                  <YAxis hide domain={['dataMin', 'dataMax']} />
                  <Line type="monotone" dataKey={k.key} stroke={colors.revenue} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title={t('overview.spendVsRevenue')} className="xl:col-span-2" action={<span className="text-xs text-zinc-500 dark:text-zinc-400">{t('overview.daily', { currency: getDisplayCurrency() })}</span>}>
          {/* Charts keep a left-to-right time axis in both languages. */}
          <div className="h-72 px-2 pb-3 pt-4 sm:h-80" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={model.daily} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.revenue} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={colors.revenue} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.spend} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={colors.spend} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={colors.grid} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  interval="preserveStartEnd"
                  tick={{ fill: colors.axis, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={28}
                />
                <YAxis tickFormatter={fmtMoneyCompact} tick={{ fill: colors.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
                <Tooltip
                  content={<ChartTooltip formatValue={(v) => fmtMoney(v)} formatLabel={formatShortDate} />}
                  cursor={{ stroke: colors.axis, strokeDasharray: '3 3' }}
                />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Area type="monotone" dataKey="revenue" name={t('common.revenue')} stroke={colors.revenue} strokeWidth={2} fill="url(#revFill)" isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: colors.surface }} />
                <Area type="monotone" dataKey="spend" name={t('common.spend')} stroke={colors.spend} strokeWidth={2} fill="url(#spendFill)" isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: colors.surface }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title={t('overview.channelSplit')} action={<span className="text-xs text-zinc-500 dark:text-zinc-400">{t('overview.shareOfSpend')}</span>}>
          <div className="flex flex-col items-center gap-2 p-4 sm:flex-row xl:flex-col">
            <div className="relative h-44 w-44 shrink-0" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={model.channels}
                    dataKey="spend"
                    nameKey="name"
                    innerRadius="64%"
                    outerRadius="100%"
                    paddingAngle={1}
                    stroke={colors.surface}
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {model.channels.map((c) => (
                      <Cell key={c.channel} fill={channelColor(theme, c.channel)} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip formatValue={(v) => `${fmtMoney(v)} (${fmtPct(v / (totalSpend || 1), 0)})`} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('common.spend')}</span>
                <span className="text-lg font-semibold tabular-nums">{fmtMoneyCompact(totalSpend)}</span>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  <th className="py-1.5 font-medium">{t('common.channel')}</th>
                  <th className="py-1.5 text-end font-medium">{t('overview.share')}</th>
                  <th className="py-1.5 text-end font-medium">ROAS</th>
                  <th className="py-1.5 text-end font-medium">CPA</th>
                </tr>
              </thead>
              <tbody>
                {model.channels.map((c) => (
                  <tr key={c.channel} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-2">
                      <ChannelBadge channel={c.channel} />
                    </td>
                    <td className="py-2 text-end tabular-nums">{fmtPct(c.spend / (totalSpend || 1), 0)}</td>
                    <td className="py-2 text-end tabular-nums">{fmtRoas(c.roas)}</td>
                    <td className="py-2 text-end tabular-nums">{fmtMoney2(c.cpa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card
        className="mt-4"
        title={t('overview.needsAttention')}
        action={
          <Link href="/app/alerts" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
            {t('overview.viewAllAlerts')}
          </Link>
        }
      >
        {alerts.length === 0 ? (
          <div className="px-4 py-6 text-sm text-zinc-500">{t('overview.noAnomalies')}</div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <SeverityBadge severity={a.severity} />
                <span className="font-medium">{t(a.titleMsg.key, a.titleMsg.vars)}</span>
                <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400">{a.campaignName}</span>
                <span className="ms-auto">
                  <ChannelBadge channel={a.channel} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
