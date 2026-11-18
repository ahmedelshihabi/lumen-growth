import { useEffect, useState } from 'react';
import { Card, cx } from './ui';
import { useLoadedApp } from '../state/AppContext';
import { useI18n } from '../i18n';
import {
  ALERT_LIMITS,
  ALERT_RULES,
  ATTRIBUTION_WINDOWS,
  DEFAULT_WORKSPACE_SETTINGS,
  anomalyConfigFrom,
  evalConfigFrom,
  type AlertSettings,
  type WorkspaceSettings,
} from '../data/settings';
import type { DictKey } from '../i18n/dict';

const input =
  'w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
const primary =
  'rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondary =
  'rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';

const CURRENCIES = ['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'USD', 'EUR', 'GBP'];
const TIMEZONES = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Muscat', 'Asia/Amman', 'Europe/London', 'UTC'];

/** Fields shown in the alert-rules card. `pct` fields are stored as fractions and edited as %. */
const FIELDS: { key: Exclude<keyof AlertSettings, 'disabled'>; pct?: boolean; step: number }[] = [
  { key: 'cpaSpikePct', pct: true, step: 5 },
  { key: 'cpaRecentDays', step: 1 },
  { key: 'cpaBaselineDays', step: 1 },
  { key: 'minConversions', step: 1 },
  { key: 'roasDropPct', pct: true, step: 5 },
  { key: 'freqCapProspecting', step: 0.5 },
  { key: 'freqCapRetargeting', step: 0.5 },
  { key: 'minActiveDays', step: 1 },
  { key: 'recMinConversions', step: 1 },
];

/** Current effective value of a field (saved value or the default). */
function effective(a: AlertSettings, key: (typeof FIELDS)[number]['key']): number {
  const an = anomalyConfigFrom(a);
  const ev = evalConfigFrom(a);
  switch (key) {
    case 'minActiveDays':
      return ev.minActiveDays;
    case 'recMinConversions':
      return ev.minConversions;
    default:
      return an[key];
  }
}

export default function WorkspaceSettingsCards() {
  const { data, settings, saveSettings } = useLoadedApp();
  const { t } = useI18n();
  const [draft, setDraft] = useState<WorkspaceSettings>(settings);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setDraft(settings), [settings]);

  const accountCurrency = data.accounts[0]?.currency ?? 'USD';
  const accountTz = data.accounts[0]?.timezone ?? 'UTC';
  const mixed = new Set(data.accounts.map((a) => a.currency)).size > 1;

  const fieldValue = (f: (typeof FIELDS)[number]) => {
    const v = effective(draft.alerts, f.key);
    return f.pct ? Math.round(v * 100) : v;
  };
  const setField = (f: (typeof FIELDS)[number], raw: string) => {
    const n = Number(raw);
    setDraft((d) => ({ ...d, alerts: { ...d.alerts, [f.key]: raw === '' ? undefined : f.pct ? n / 100 : n } }));
  };
  const invalid = FIELDS.some((f) => {
    const raw = draft.alerts[f.key];
    if (raw === undefined) return false;
    const [lo, hi] = ALERT_LIMITS[f.key];
    return !(typeof raw === 'number' && Number.isFinite(raw) && raw >= lo && raw <= hi);
  });
  const disabled = new Set(draft.alerts.disabled ?? []);
  const toggleRule = (r: (typeof ALERT_RULES)[number]) =>
    setDraft((d) => {
      const set = new Set(d.alerts.disabled ?? []);
      if (set.has(r)) set.delete(r);
      else set.add(r);
      return { ...d, alerts: { ...d.alerts, disabled: [...set] } };
    });

  const save = async (next: WorkspaceSettings) => {
    setState('saving');
    setErr(null);
    try {
      await saveSettings(next);
      setState('saved');
      window.setTimeout(() => setState('idle'), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  };

  const status = (
    <span role="status" className={cx('text-sm', state === 'error' ? 'text-red-600' : 'text-emerald-600 dark:text-emerald-400')}>
      {state === 'saved' ? t('common.saved') : state === 'error' ? t('common.error', { message: err ?? '' }) : ''}
    </span>
  );

  return (
    <>
      <Card className="mt-4" title={t('wsSettings.title')} action={<span className="text-xs text-zinc-500 dark:text-zinc-400">{t('wsSettings.shared')}</span>}>
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {t('wsSettings.currency')}
            <select className={`${input} mt-1`} value={draft.currency ?? ''} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value || null }))}>
              <option value="">{t('wsSettings.auto', { v: accountCurrency })}</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-normal text-zinc-500 dark:text-zinc-400">{t(mixed ? 'wsSettings.currencyMixed' : 'wsSettings.currencyNote')}</span>
          </label>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {t('wsSettings.timezone')}
            <select className={`${input} mt-1`} value={draft.timezone ?? ''} onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value || null }))}>
              <option value="">{t('wsSettings.auto', { v: accountTz })}</option>
              {TIMEZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-normal text-zinc-500 dark:text-zinc-400">{t('wsSettings.timezoneNote')}</span>
          </label>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {t('wsSettings.attribution')}
            <select
              className={`${input} mt-1`}
              value={draft.attributionWindow}
              onChange={(e) => setDraft((d) => ({ ...d, attributionWindow: e.target.value as WorkspaceSettings['attributionWindow'] }))}
            >
              {ATTRIBUTION_WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {t(`wsSettings.attr.${w}` as DictKey)}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-normal text-zinc-500 dark:text-zinc-400">{t('wsSettings.attributionNote')}</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <button type="button" className={primary} disabled={state === 'saving'} onClick={() => save({ ...settings, currency: draft.currency, timezone: draft.timezone, attributionWindow: draft.attributionWindow })}>
            {t('common.save')}
          </button>
          {status}
        </div>
      </Card>

      <Card className="mt-4" title={t('alertRules.title')} action={<span className="text-xs text-zinc-500 dark:text-zinc-400">{t('alertRules.note')}</span>}>
        <div className="p-4">
          <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">{t('alertRules.enabled')}</div>
          <div className="flex flex-wrap gap-2">
            {ALERT_RULES.map((r) => {
              const on = !disabled.has(r);
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleRule(r)}
                  className={cx(
                    'rounded-full border px-3 py-1 text-xs font-medium',
                    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-zinc-200 text-zinc-500 line-through dark:border-zinc-700',
                  )}
                >
                  {t(`anomaly.${r}`)}
                </button>
              );
            })}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {FIELDS.map((f) => {
              const [lo, hi] = ALERT_LIMITS[f.key];
              const raw = draft.alerts[f.key];
              const bad = raw !== undefined && !(typeof raw === 'number' && raw >= lo && raw <= hi);
              return (
                <label key={f.key} className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  {t(`alertRules.f.${f.key}` as DictKey)}
                  <input
                    type="number"
                    inputMode="decimal"
                    dir="ltr"
                    step={f.step}
                    min={f.pct ? lo * 100 : lo}
                    max={f.pct ? hi * 100 : hi}
                    value={fieldValue(f)}
                    onChange={(e) => setField(f, e.target.value)}
                    className={cx(input, 'mt-1', bad && 'border-red-500')}
                  />
                  <span className="mt-0.5 block font-normal text-zinc-400" dir="ltr">
                    {f.pct ? `${lo * 100}–${hi * 100}%` : `${lo}–${hi}`}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <button type="button" className={primary} disabled={invalid || state === 'saving'} onClick={() => save({ ...settings, alerts: draft.alerts })}>
            {t('alertRules.save')}
          </button>
          <button type="button" className={secondary} onClick={() => save({ ...settings, alerts: DEFAULT_WORKSPACE_SETTINGS.alerts })}>
            {t('settings.reset')}
          </button>
          {invalid && <span className="text-sm text-red-600">{t('alertRules.invalid')}</span>}
          {status}
        </div>
      </Card>
    </>
  );
}
