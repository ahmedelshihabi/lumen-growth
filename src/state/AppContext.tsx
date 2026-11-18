import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Dataset } from '../data/types';
import { loadDataset, type DataSource, type Dismissals } from '../data/source';
import { isHidden, snoozeUntil, type SnoozeFor } from '../rules/keys';
import { setDisplayCurrency } from '../lib/format';
import { deriveTargets } from '../rules/targets';
import { DEFAULT_WORKSPACE_SETTINGS, anomalyConfigFrom, evalConfigFrom, type WorkspaceSettings } from '../data/settings';
import type { RulesInput, TargetsByAccount } from '../rules/types';

export type RangeDays = 7 | 14 | 30 | 90;
export type Theme = 'light' | 'dark';

const THEME_KEY = 'lumen.theme';
const RANGE_KEY = 'lumen.range';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable - keep in-memory state */
  }
}

interface AppState {
  source: DataSource;
  data: Dataset | null;
  /** Re-read everything from the source (after a sync or a budget edit). */
  reload: () => void;
  error: string | null;
  rangeDays: RangeDays;
  setRangeDays: (d: RangeDays) => void;
  /** Effective goals: saved goals, plus automatic ones (account average) for the rest. */
  targets: TargetsByAccount;
  /** Accounts whose goals are automatic (nobody has saved goals for them yet). */
  autoTargetIds: string[];
  setTargets: (t: TargetsByAccount) => void;
  resetTargets: () => void;
  /** Workspace settings (currency, timezone, attribution, alert rules); shared by the team. */
  settings: WorkspaceSettings;
  saveSettings: (s: WorkspaceSettings) => Promise<void>;
  /** Snoozed / dismissed alerts and recommendations (shared by the team). */
  dismissals: Dismissals;
  hide: (key: string, f: SnoozeFor) => void;
  restore: (key: string) => void;
  isHidden: (key: string) => boolean;
  theme: Theme;
  toggleTheme: () => void;
  /** Convenience bundle for the rules engines (null while loading). */
  rulesInput: RulesInput | null;
}

const Ctx = createContext<AppState | null>(null);

function initialTheme(): Theme {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return 'dark';
  return 'light';
}

export function AppProvider({ children, source }: { children: ReactNode; source: DataSource }) {
  const [data, setData] = useState<Dataset | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const [error, setError] = useState<string | null>(null);
  const [rangeDays, setRange] = useState<RangeDays>(() => {
    const v = Number(readJSON<number>(RANGE_KEY, 30));
    return ([7, 14, 30, 90] as const).includes(v as RangeDays) ? (v as RangeDays) : 30;
  });
  const [savedTargets, setSavedTargets] = useState<TargetsByAccount>({});
  const [settings, setSettings] = useState<WorkspaceSettings>(DEFAULT_WORKSPACE_SETTINGS);
  const [dismissals, setDismissals] = useState<Dismissals>({});
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    let alive = true;
    setError(null);
    Promise.all([loadDataset(source), source.getTargets(), source.getSettings(), source.getDismissals().catch(() => ({}))])
      .then(([d, saved, ws, dm]) => {
        if (!alive) return;
        const currency = ws.currency ?? d.accounts[0]?.currency;
        if (currency) setDisplayCurrency(currency);
        setSettings(ws);
        setDismissals(dm);
        setSavedTargets(saved);
        setData(d);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [source, version]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const setRangeDays = useCallback((d: RangeDays) => {
    setRange(d);
    write(RANGE_KEY, String(d));
  }, []);

  const autoTargets = useMemo<TargetsByAccount>(
    () => (data ? deriveTargets(data.campaigns, data.campaignDaily, data.asOf) : {}),
    [data],
  );
  const targets = useMemo<TargetsByAccount>(() => ({ ...autoTargets, ...savedTargets }), [autoTargets, savedTargets]);
  const autoTargetIds = useMemo(
    () => (data ? data.accounts.map((a) => a.id).filter((id) => !(id in savedTargets) && id in autoTargets) : []),
    [data, savedTargets, autoTargets],
  );

  const setTargets = useCallback(
    (t: TargetsByAccount) => {
      setSavedTargets((prev) => ({ ...prev, ...t }));
      source.saveTargets(t).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    [source],
  );

  const resetTargets = useCallback(() => {
    setSavedTargets({});
    source
      .saveTargets(null)
      .then(() => source.getTargets())
      .then(setSavedTargets)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [source]);

  const saveSettings = useCallback(
    async (next: WorkspaceSettings) => {
      await source.saveSettings(next);
      const currency = next.currency ?? data?.accounts[0]?.currency;
      if (currency) setDisplayCurrency(currency);
      setSettings(next);
    },
    [source, data],
  );

  const hide = useCallback(
    (key: string, f: SnoozeFor) => {
      const until = snoozeUntil(f);
      setDismissals((d) => ({ ...d, [key]: until }));
      source.dismiss(key, until).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    [source],
  );
  const restore = useCallback(
    (key: string) => {
      setDismissals((d) => {
        const n = { ...d };
        delete n[key];
        return n;
      });
      source.restore(key).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    [source],
  );
  const isHiddenFn = useCallback((key: string) => isHidden(dismissals, key), [dismissals]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      write(THEME_KEY, next);
      return next;
    });
  }, []);

  const rulesInput = useMemo<RulesInput | null>(
    () =>
      data
        ? {
            campaigns: data.campaigns,
            campaignDaily: data.campaignDaily,
            creatives: data.creatives,
            creativeDaily: data.creativeDaily,
            asOf: data.asOf,
            targets,
            accountNames: Object.fromEntries(data.accounts.map((a) => [a.id, a.name])),
            anomalyConfig: anomalyConfigFrom(settings.alerts),
            evalConfig: evalConfigFrom(settings.alerts),
          }
        : null,
    [data, targets, settings],
  );

  const value = useMemo<AppState>(
    () => ({ source, data, reload, error, rangeDays, setRangeDays, targets, autoTargetIds, setTargets, resetTargets, settings, saveSettings, dismissals, hide, restore, isHidden: isHiddenFn, theme, toggleTheme, rulesInput }),
    [source, data, reload, error, rangeDays, setRangeDays, targets, autoTargetIds, setTargets, resetTargets, settings, saveSettings, dismissals, hide, restore, isHiddenFn, theme, toggleTheme, rulesInput],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

/** Use inside pages rendered only after data has loaded. */
export function useLoadedApp() {
  const app = useApp();
  if (!app.data || !app.rulesInput) throw new Error('Data not loaded');
  return { ...app, data: app.data, rulesInput: app.rulesInput };
}
