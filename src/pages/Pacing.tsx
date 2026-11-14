import { useMemo } from 'react';
import { Card, ChannelBadge, PageHeader, StatCard, cx } from '../components/ui';
import { useLoadedApp } from '../state/AppContext';
import { computePacing, type PacingResult, type PacingStatus } from '../rules/pacing';
import { fmtMoney } from '../lib/format';
import { formatMonth } from '../lib/dates';
import { CHANNEL_LABEL, channelColor } from '../lib/colors';
import type { Campaign, Channel } from '../data/types';

const STATUS: Record<PacingStatus, { label: string; cls: string }> = {
  over: { label: 'Over-pacing', cls: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30' },
  under: { label: 'Under-pacing', cls: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30' },
  on_track: { label: 'On track', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30' },
  paused: { label: 'Paused', cls: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-600/30' },
};

function PacingBar({ p, color }: { p: { monthlyBudget: number; mtdSpend: number; projected: number; expectedToDate: number }; color: string }) {
  const max = Math.max(p.monthlyBudget, p.projected) * 1.05 || 1;
  const w = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <div className="relative h-2.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" role="img" aria-label={`Spent ${fmtMoney(p.mtdSpend)}, projected ${fmtMoney(p.projected)} of ${fmtMoney(p.monthlyBudget)}`}>
      <div className="absolute inset-y-0 left-0 rounded-full opacity-30" style={{ width: w(p.projected), background: color }} />
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: w(p.mtdSpend), background: color }} />
      <div className="absolute -inset-y-1 w-0.5 rounded bg-zinc-900 dark:bg-zinc-100" style={{ left: w(p.monthlyBudget) }} title="Monthly budget" />
      <div className="absolute -inset-y-0.5 w-px bg-zinc-400 dark:bg-zinc-500" style={{ left: w(p.expectedToDate) }} title="Expected spend to date" />
    </div>
  );
}

export default function Pacing() {
  const { data, theme } = useLoadedApp();

  const rows = useMemo(
    () =>
      data.campaigns
        .map((c) => ({ campaign: c, p: computePacing(c, data.campaignDaily, data.asOf) }))
        .sort((a, b) => Math.abs(b.p.pacing - 1) - Math.abs(a.p.pacing - 1)),
    [data],
  );

  const byChannel = useMemo(() => {
    const out = new Map<Channel, { budget: number; mtd: number; projected: number; expected: number }>();
    for (const { campaign, p } of rows) {
      const acc = out.get(campaign.channel) ?? { budget: 0, mtd: 0, projected: 0, expected: 0 };
      acc.budget += p.monthlyBudget;
      acc.mtd += p.mtdSpend;
      acc.projected += p.projected;
      acc.expected += p.expectedToDate;
      out.set(campaign.channel, acc);
    }
    return out;
  }, [rows]);

  const total = [...byChannel.values()].reduce(
    (a, c) => ({ budget: a.budget + c.budget, mtd: a.mtd + c.mtd, projected: a.projected + c.projected }),
    { budget: 0, mtd: 0, projected: 0 },
  );
  const first = rows[0]?.p;
  const over = rows.filter((r) => r.p.status === 'over').length;
  const under = rows.filter((r) => r.p.status === 'under').length;

  return (
    <>
      <PageHeader
        title="Budget pacing"
        subtitle={`${formatMonth(data.asOf)} · day ${first?.daysElapsed} of ${(first?.daysElapsed ?? 0) + (first?.daysRemaining ?? 0)} · projection = month-to-date + 7-day run rate × days left`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Monthly budget" value={fmtMoney(total.budget)} />
        <StatCard label="Spent to date" value={fmtMoney(total.mtd)} sub={`${Math.round((total.mtd / (total.budget || 1)) * 100)}% of budget`} />
        <StatCard
          label="Projected month-end"
          value={fmtMoney(total.projected)}
          sub={`${total.projected >= total.budget ? '+' : ''}${fmtMoney(total.projected - total.budget)} vs plan`}
          tone={total.projected > total.budget * 1.1 ? 'red' : total.projected < total.budget * 0.9 ? 'amber' : 'green'}
        />
        <StatCard label="Flags" value={`${over + under}`} sub={`${over} over · ${under} under`} tone={over + under > 0 ? 'amber' : 'green'} />
      </div>

      <Card className="mt-4" title="By channel">
        <div className="grid gap-4 p-4 md:grid-cols-3">
          {[...byChannel.entries()].map(([ch, c]) => {
            const pct = c.projected / (c.budget || 1);
            return (
              <div key={ch}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{CHANNEL_LABEL[ch]}</span>
                  <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {fmtMoney(c.projected)} / {fmtMoney(c.budget)} ({Math.round(pct * 100)}%)
                  </span>
                </div>
                <PacingBar p={{ monthlyBudget: c.budget, mtdSpend: c.mtd, projected: c.projected, expectedToDate: c.expected }} color={channelColor(theme, ch)} />
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-zinc-500" /> Spent to date</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-zinc-500/30" /> Projected</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-zinc-900 dark:bg-zinc-100" /> Monthly budget</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-px bg-zinc-400" /> Expected to date</span>
        </div>
      </Card>

      <Card className="mt-4" title="By campaign">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map(({ campaign, p }) => (
            <PacingRow key={campaign.id} campaign={campaign} p={p} color={channelColor(theme, campaign.channel)} />
          ))}
        </ul>
      </Card>
    </>
  );
}

function PacingRow({ campaign, p, color }: { campaign: Campaign; p: PacingResult; color: string }) {
  const s = STATUS[p.status];
  const diff = p.projected - p.monthlyBudget;
  return (
    <li className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_210px] md:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium" title={campaign.name}>
          {campaign.name}
        </div>
        <div className="mt-0.5">
          <ChannelBadge channel={campaign.channel} />
        </div>
      </div>
      <div>
        <PacingBar p={p} color={color} />
        <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
          <span>Spent {fmtMoney(p.mtdSpend)}</span>
          <span>Run rate {fmtMoney(p.runRate)}/day</span>
          <span>
            Projected {fmtMoney(p.projected)} of {fmtMoney(p.monthlyBudget)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 md:flex-col md:items-end md:gap-1">
        <span className={cx('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', s.cls)}>
          {s.label} {p.status !== 'paused' && `${Math.round(p.pacing * 100)}%`}
        </span>
        {(p.status === 'over' || p.status === 'under') && (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {diff > 0 ? '+' : ''}
            {fmtMoney(diff)} · aim for {fmtMoney(p.recommendedDaily)}/day
          </span>
        )}
      </div>
    </li>
  );
}
