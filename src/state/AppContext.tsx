import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Dataset } from '../data/types';
import { loadDataset } from '../data/source';
import { DEFAULT_TARGETS } from '../rules/targets';
import type { RulesInput, TargetsByAccount } from '../rules/types';

export type RangeDays = 7 | 14 | 30 | 90;
export type Theme = 'light' | 'dark';

const TARGETS_KEY = 'lumen.targets.v1';
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
  data: Dataset | null;
  error: string | null;
  rangeDays: RangeDays;
  setRangeDays: (d: RangeDays) => void;
  targets: TargetsByAccount;
  setTargets: (t: TargetsByAccount) => void;
  resetTargets: () => void;
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rangeDays, setRange] = useState<RangeDays>(() => {
    const v = Number(readJSON<number>(RANGE_KEY, 30));
    return ([7, 14, 30, 90] as const).includes(v as RangeDays) ? (v as RangeDays) : 30;
  });
  const [targets, setTargetsState] = useState<TargetsByAccount>(() => ({
    ...DEFAULT_TARGETS,
    ...readJSON<TargetsByAccount>(TARGETS_KEY, {}),
  }));
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    let alive = true;
    loadDataset()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const setRangeDays = useCallback((d: RangeDays) => {
    setRange(d);
    write(RANGE_KEY, String(d));
  }, []);

  const setTargets = useCallback((t: TargetsByAccount) => {
    setTargetsState(t);
    write(TARGETS_KEY, JSON.stringify(t));
  }, []);

  const resetTargets = useCallback(() => {
    setTargetsState({ ...DEFAULT_TARGETS });
    try {
      localStorage.removeItem(TARGETS_KEY);
    } catch {
      /* ignore */
    }
  }, []);

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
          }
        : null,
    [data, targets],
  );

  const value = useMemo<AppState>(
    () => ({ data, error, rangeDays, setRangeDays, targets, setTargets, resetTargets, theme, toggleTheme, rulesInput }),
    [data, error, rangeDays, setRangeDays, targets, setTargets, resetTargets, theme, toggleTheme, rulesInput],
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
