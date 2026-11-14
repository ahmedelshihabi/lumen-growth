import { useMemo, useState } from 'react';
import { Card, ChannelBadge, EmptyState, PageHeader, Select, SeverityBadge, StatCard } from '../components/ui';
import { useLoadedApp } from '../state/AppContext';
import { detectAnomalies, DEFAULT_ANOMALY_CONFIG, type AnomalyType, type Severity } from '../rules/anomalies';
import { formatShortDate } from '../lib/dates';

const TYPE_LABEL: Record<AnomalyType, string> = {
  cpa_spike: 'CPA spike',
  roas_drop: 'ROAS drop',
  spend_stopped: 'Spend stopped',
  high_frequency: 'High frequency',
};

export default function Alerts() {
  const { rulesInput } = useLoadedApp();
  const [severity, setSeverity] = useState<'all' | Severity>('all');
  const [type, setType] = useState<'all' | AnomalyType>('all');

  const all = useMemo(() => detectAnomalies(rulesInput), [rulesInput]);
  const shown = all.filter((a) => (severity === 'all' || a.severity === severity) && (type === 'all' || a.type === type));
  const count = (s: Severity) => all.filter((a) => a.severity === s).length;
  const cfg = DEFAULT_ANOMALY_CONFIG;

  return (
    <>
      <PageHeader title="Alerts" subtitle={`Rule-based anomaly detection · data through ${formatShortDate(rulesInput.asOf)}`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Critical" value={count('critical')} tone={count('critical') ? 'red' : undefined} />
        <StatCard label="High" value={count('high')} tone={count('high') ? 'red' : undefined} />
        <StatCard label="Medium" value={count('medium')} tone={count('medium') ? 'amber' : undefined} />
        <StatCard label="Campaigns affected" value={new Set(all.map((a) => a.campaignId)).size} />
      </div>

      <Card
        className="mt-4"
        title={`${shown.length} alert${shown.length === 1 ? '' : 's'}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Select
              label="Severity"
              value={severity}
              onChange={setSeverity}
              options={[
                { value: 'all', label: 'All severities' },
                { value: 'critical', label: 'Critical' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
              ]}
            />
            <Select
              label="Type"
              value={type}
              onChange={setType}
              options={[{ value: 'all', label: 'All types' }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value: value as AnomalyType, label }))]}
            />
          </div>
        }
      >
        {shown.length === 0 ? (
          <EmptyState>No alerts match these filters.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {shown.map((a) => (
              <li key={a.id} className="flex gap-3 px-4 py-3.5">
                <div className="w-[72px] shrink-0 pt-0.5">
                  <SeverityBadge severity={a.severity} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold">{a.title}</span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{TYPE_LABEL[a.type]}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{a.detail}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <ChannelBadge channel={a.channel} />
                    <span className="truncate">{a.campaignName}</span>
                  </div>
                </div>
                <time className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400" dateTime={a.date}>
                  {formatShortDate(a.date)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-4" title="Active rules">
        <ul className="grid gap-px overflow-hidden rounded-b-xl bg-zinc-100 text-sm dark:bg-zinc-800 sm:grid-cols-2">
          {[
            ['CPA spike', `CPA up more than ${cfg.cpaSpikePct * 100}% day over day (prior day ≥ ${cfg.minConversions} conversions), last ${cfg.lookbackDays} days.`],
            ['ROAS drop', `Last ${cfg.roasRecentDays}-day ROAS down more than ${cfg.roasDropPct * 100}% vs the ${cfg.roasBaselineDays} days before.`],
            ['Spend stopped', 'A non-paused campaign with $0 spend on the latest day after spending ≥ $50/day.'],
            ['High frequency', `Latest 7-day frequency above ${cfg.frequencyMax}.`],
          ].map(([name, desc]) => (
            <li key={name} className="bg-white p-4 dark:bg-zinc-900">
              <div className="font-medium">{name}</div>
              <div className="mt-0.5 text-zinc-500 dark:text-zinc-400">{desc}</div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
