import { useMemo, useState } from 'react';
import { Card, ChannelBadge, EmptyState, PageHeader, Select, SeverityBadge, StatCard } from '../components/ui';
import { useLoadedApp } from '../state/AppContext';
import { detectAnomalies, DEFAULT_ANOMALY_CONFIG, type AnomalyType, type Severity } from '../rules/anomalies';
import { formatShortDate } from '../lib/dates';
import { useI18n } from '../i18n';

const TYPES: AnomalyType[] = ['account_stopped', 'cpa_spike', 'roas_drop', 'spend_stopped', 'high_frequency'];

export default function Alerts() {
  const { rulesInput } = useLoadedApp();
  const { t } = useI18n();
  const [severity, setSeverity] = useState<'all' | Severity>('all');
  const [type, setType] = useState<'all' | AnomalyType>('all');

  const all = useMemo(() => detectAnomalies(rulesInput), [rulesInput]);
  const shown = all.filter((a) => (severity === 'all' || a.severity === severity) && (type === 'all' || a.type === type));
  const count = (s: Severity) => all.filter((a) => a.severity === s).length;
  const cfg = DEFAULT_ANOMALY_CONFIG;

  return (
    <>
      <PageHeader title={t('nav.alerts')} subtitle={t('alerts.subtitle', { date: formatShortDate(rulesInput.asOf) })} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('severity.critical')} value={count('critical')} tone={count('critical') ? 'red' : undefined} />
        <StatCard label={t('severity.high')} value={count('high')} tone={count('high') ? 'red' : undefined} />
        <StatCard label={t('severity.medium')} value={count('medium')} tone={count('medium') ? 'amber' : undefined} />
        <StatCard label={t('alerts.campaignsAffected')} value={new Set(all.filter((a) => a.campaignId).map((a) => a.campaignId)).size} />
      </div>

      <Card
        className="mt-4"
        title={t('alerts.count', { n: shown.length })}
        action={
          <div className="flex flex-wrap gap-2">
            <Select
              label={t('alerts.severity')}
              value={severity}
              onChange={setSeverity}
              options={[
                { value: 'all', label: t('alerts.allSeverities') },
                { value: 'critical', label: t('severity.critical') },
                { value: 'high', label: t('severity.high') },
                { value: 'medium', label: t('severity.medium') },
              ]}
            />
            <Select
              label={t('alerts.type')}
              value={type}
              onChange={setType}
              options={[{ value: 'all', label: t('alerts.allTypes') }, ...TYPES.map((value) => ({ value, label: t(`anomaly.${value}`) }))]}
            />
          </div>
        }
      >
        {shown.length === 0 ? (
          <EmptyState>{t('common.noMatch')}</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {shown.map((a) => (
              <li key={a.id} className="flex gap-3 px-4 py-3.5">
                <div className="w-[72px] shrink-0 pt-0.5">
                  <SeverityBadge severity={a.severity} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold" dir="auto">{t(a.titleMsg.key, a.titleMsg.vars)}</span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{t(`anomaly.${a.type}`)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300" dir="auto">{t(a.detailMsg.key, a.detailMsg.vars)}</p>
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

      <Card className="mt-4" title={t('alerts.activeRules')}>
        <ul className="grid gap-px overflow-hidden rounded-b-xl bg-zinc-100 text-sm dark:bg-zinc-800 sm:grid-cols-2">
          {[
            [t('anomaly.cpa_spike'), t('alerts.rule.cpa', { pct: cfg.cpaSpikePct * 100, min: cfg.minConversions, recent: cfg.cpaRecentDays, base: cfg.cpaBaselineDays })],
            [t('anomaly.roas_drop'), t('alerts.rule.roas', { recent: cfg.roasRecentDays, pct: cfg.roasDropPct * 100, base: cfg.roasBaselineDays })],
            [t('anomaly.spend_stopped'), t('alerts.rule.stopped')],
            [t('anomaly.account_stopped'), t('alerts.rule.account')],
            [t('anomaly.high_frequency'), t('alerts.rule.freq', { pro: cfg.freqCapProspecting, rtg: cfg.freqCapRetargeting })],
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
