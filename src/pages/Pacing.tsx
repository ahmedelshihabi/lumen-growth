import { useMemo } from 'react';
import { Card, ChannelBadge, PageHeader, StatCard, cx } from '../components/ui';
import { useLoadedApp } from '../state/AppContext';
import { computePacing, pacingAdvice, type PacingAdvice, type PacingResult, type PacingStatus } from '../rules/pacing';
import { summarizeCampaigns } from '../rules/summary';
import { rangeEnding } from '../lib/metrics';
import { fmtMoney } from '../lib/format';
import { formatMonth } from '../lib/dates';
import { CHANNEL_LABEL, channelColor } from '../lib/colors';
import type { Campaign, Channel } from '../data/types';
import { Link } from '../lib/router';
import { useI18n } from '../i18n';

const STATUS: Record<PacingStatus, { cls: string }> = {
  over: { cls: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30' },
  under: { cls: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30' },
  on_track: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30' },
  paused: { cls: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-600/30' },
};

function PacingBar({ p, color }: { p: { monthlyBudget: number; mtdSpend: number; projected: number; expectedToDate: number }; color: string }) {
  const max = Math.max(p.monthlyBudget, p.projected) * 1.05 || 1;
  const w = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <div className="relative h-2.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" role="img" aria-label={`Spent ${fmtMoney(p.mtdSpend)}, projected ${fmtMoney(p.projected)} of ${fmtMoney(p.monthlyBudget)}`}>
      <div className="absolute inset-y-0 start-0 rounded-full opacity-30" style={{ width: w(p.projected), background: color }} />
      <div className="absolute inset-y-0 start-0 rounded-full" style={{ width: w(p.mtdSpend), background: color }} />
      <div className="absolute -inset-y-1 w-0.5 rounded bg-zinc-900 dark:bg-zinc-100" style={{ insetInlineStart: w(p.monthlyBudget) }} title="Monthly budget" />
      <div className="absolute -inset-y-0.5 w-px bg-zinc-400 dark:bg-zinc-500" style={{ insetInlineStart: w(p.expectedToDate) }} title="Expected spend to date" />
    </div>
  );
}

export default function Pacing() {
  const { data, theme, targets } = useLoadedApp();
  const { t } = useI18n();
  // Campaigns without a monthly plan (Meta has none) cannot be paced: they are listed as missing.
  const missing = data.campaigns.filter((c) => !(c.monthlyBudget > 0)).length;

  // Same evaluation as Recommendations (last 14 days), so both pages give the same advice.
  const verdicts = useMemo(
    () => new Map(summarizeCampaigns(data.campaigns, data.campaignDaily, rangeEnding(data.asOf, 14), targets).map((s) => [s.campaign.id, s])),
    [data, targets],
  );
  const rows = useMemo(
    () =>
      data.campaigns
        .filter((c) => c.monthlyBudget > 0)
        .map((c) => {
          const p = computePacing(c, data.campaignDaily, data.asOf);
          const s = verdicts.get(c.id);
          return { campaign: c, p, advice: pacingAdvice(p, s?.quality.sufficient ? s.verdict : null) };
        })
        .sort((a, b) => Math.abs(b.p.pacing - 1) - Math.abs(a.p.pacing - 1)),
    [data, verdicts],
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

  const day = Number(data.asOf.slice(8, 10));
  const header = (
    <PageHeader
      title={t('nav.pacing')}
      subtitle={t('pacing.subtitle', { month: formatMonth(data.asOf), day: first?.daysElapsed ?? day, total: (first?.daysElapsed ?? 0) + (first?.daysRemaining ?? 0) || day })}
      actions={
        <Link href="/app/settings" className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {t('pacing.setBudgets')}
        </Link>
      }
    />
  );

  if (rows.length === 0) {
    return (
      <>
        {header}
        <Card className="p-6 text-sm text-zinc-600 dark:text-zinc-300">{t('pacing.noBudgets')}</Card>
      </>
    );
  }

  return (
    <>
      {header}
      {missing > 0 && <p className="-mt-2 mb-4 text-xs text-zinc-500 dark:text-zinc-400">{t('pacing.missingBudgets', { n: missing })}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('pacing.monthlyBudget')} value={fmtMoney(total.budget)} />
        <StatCard label={t('pacing.spentToDate')} value={fmtMoney(total.mtd)} sub={t('pacing.ofBudget', { pct: Math.round((total.mtd / (total.budget || 1)) * 100) })} />
        <StatCard
          label={t('pacing.projected')}
          value={fmtMoney(total.projected)}
          sub={t('pacing.vsPlan', { diff: `${total.projected >= total.budget ? '+' : ''}${fmtMoney(total.projected - total.budget)}` })}
          tone={total.projected > total.budget * 1.1 ? 'red' : total.projected < total.budget * 0.9 ? 'amber' : 'green'}
        />
        <StatCard label={t('pacing.flags')} value={`${over + under}`} sub={t('pacing.flagsSub', { over, under })} tone={over + under > 0 ? 'amber' : 'green'} />
      </div>

      <Card className="mt-4" title={t('pacing.byChannel')}>
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
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-zinc-500" /> {t('pacing.legendSpent')}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-zinc-500/30" /> {t('pacing.legendProjected')}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-zinc-900 dark:bg-zinc-100" /> {t('pacing.legendBudget')}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-px bg-zinc-400" /> {t('pacing.legendExpected')}</span>
        </div>
      </Card>

      <Card className="mt-4" title={t('pacing.byCampaign')}>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map(({ campaign, p, advice }) => (
            <PacingRow key={campaign.id} campaign={campaign} p={p} advice={advice} color={channelColor(theme, campaign.channel)} />
          ))}
        </ul>
      </Card>
    </>
  );
}

function PacingRow({ campaign, p, advice, color }: { campaign: Campaign; p: PacingResult; advice: PacingAdvice; color: string }) {
  const { t } = useI18n();
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
          <span>{t('pacing.spent', { v: fmtMoney(p.mtdSpend) })}</span>
          <span>{t('pacing.runRate', { v: fmtMoney(p.runRate) })}</span>
          <span>{t('pacing.projectedOf', { p: fmtMoney(p.projected), b: fmtMoney(p.monthlyBudget) })}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 md:flex-col md:items-end md:gap-1">
        <span className={cx('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', s.cls)}>
          {t(`pacing.label.${p.status}`, { pct: `${Math.round(p.pacing * 100)}%` })}
        </span>
        {advice !== 'none' && (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {diff > 0 ? '+' : ''}
            {fmtMoney(diff)} · {t(`pacing.advice.${advice}`, { v: fmtMoney(p.recommendedDaily), plan: fmtMoney(p.projected) })}
          </span>
        )}
      </div>
    </li>
  );
}
