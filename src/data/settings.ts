/**
 * Workspace settings shared by the team (stored in public.workspace_settings; in demo mode
 * in this browser). The rules engine reads its thresholds from here.
 */
import { DEFAULT_ANOMALY_CONFIG, type AnomalyConfig, type AnomalyType } from '../rules/anomalies';
import { DEFAULT_EVAL_CONFIG, type EvalConfig } from '../rules/evaluate';

// 28-day click is no longer offered by Meta, so it is not listed (the DB still accepts it).
export const ATTRIBUTION_WINDOWS = ['default', '1d_click', '7d_click', '7d_click_1d_view'] as const;
export type AttributionWindow = (typeof ATTRIBUTION_WINDOWS)[number];
export const ALERT_RULES: AnomalyType[] = ['account_stopped', 'spend_stopped', 'cpa_spike', 'roas_drop', 'high_frequency'];

export interface AlertSettings {
  disabled?: AnomalyType[];
  /** 0.3 = +30% */
  cpaSpikePct?: number;
  cpaRecentDays?: number;
  cpaBaselineDays?: number;
  minConversions?: number;
  roasDropPct?: number;
  freqCapProspecting?: number;
  freqCapRetargeting?: number;
  /** Minimum data before any recommendation. */
  minActiveDays?: number;
  recMinConversions?: number;
}

export interface WorkspaceSettings {
  /** Display currency; null = the ad accounts' currency. */
  currency: string | null;
  /** IANA timezone; null = the ad accounts' timezone. */
  timezone: string | null;
  attributionWindow: AttributionWindow;
  alerts: AlertSettings;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  currency: null,
  timezone: null,
  attributionWindow: 'default',
  alerts: {},
};

/** Allowed range for each numeric threshold: [min, max]. Out-of-range values fall back to the default. */
export const ALERT_LIMITS: Record<Exclude<keyof AlertSettings, 'disabled'>, [number, number]> = {
  cpaSpikePct: [0.05, 3],
  cpaRecentDays: [1, 14],
  cpaBaselineDays: [3, 60],
  minConversions: [1, 500],
  roasDropPct: [0.05, 0.95],
  freqCapProspecting: [1, 20],
  freqCapRetargeting: [1, 30],
  minActiveDays: [1, 30],
  recMinConversions: [1, 500],
};

const pick = (v: unknown, key: keyof typeof ALERT_LIMITS, fallback: number): number => {
  const [lo, hi] = ALERT_LIMITS[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;
};

export function anomalyConfigFrom(a: AlertSettings = {}): AnomalyConfig {
  const d = DEFAULT_ANOMALY_CONFIG;
  return {
    ...d,
    cpaSpikePct: pick(a.cpaSpikePct, 'cpaSpikePct', d.cpaSpikePct),
    cpaRecentDays: Math.round(pick(a.cpaRecentDays, 'cpaRecentDays', d.cpaRecentDays)),
    cpaBaselineDays: Math.round(pick(a.cpaBaselineDays, 'cpaBaselineDays', d.cpaBaselineDays)),
    minConversions: Math.round(pick(a.minConversions, 'minConversions', d.minConversions)),
    roasDropPct: pick(a.roasDropPct, 'roasDropPct', d.roasDropPct),
    freqCapProspecting: pick(a.freqCapProspecting, 'freqCapProspecting', d.freqCapProspecting),
    freqCapRetargeting: pick(a.freqCapRetargeting, 'freqCapRetargeting', d.freqCapRetargeting),
    disabled: (a.disabled ?? []).filter((r) => ALERT_RULES.includes(r)),
  };
}

export function evalConfigFrom(a: AlertSettings = {}): EvalConfig {
  const d = DEFAULT_EVAL_CONFIG;
  return {
    ...d,
    freqCapProspecting: pick(a.freqCapProspecting, 'freqCapProspecting', d.freqCapProspecting),
    freqCapRetargeting: pick(a.freqCapRetargeting, 'freqCapRetargeting', d.freqCapRetargeting),
    minActiveDays: Math.round(pick(a.minActiveDays, 'minActiveDays', d.minActiveDays)),
    minConversions: Math.round(pick(a.recMinConversions, 'recMinConversions', d.minConversions)),
  };
}

/** Parse whatever came from storage into valid settings. */
export function normalizeSettings(raw: Partial<WorkspaceSettings> | null | undefined): WorkspaceSettings {
  const r = raw ?? {};
  return {
    currency: typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null,
    timezone: typeof r.timezone === 'string' && r.timezone.length >= 3 ? r.timezone : null,
    attributionWindow: (ATTRIBUTION_WINDOWS as readonly string[]).includes(r.attributionWindow as string)
      ? (r.attributionWindow as AttributionWindow)
      : 'default',
    alerts: r.alerts && typeof r.alerts === 'object' ? r.alerts : {},
  };
}
