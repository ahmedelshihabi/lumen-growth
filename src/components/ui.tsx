import type { ReactNode } from 'react';
import type { Channel } from '../data/types';
import type { Health } from '../rules/health';
import type { Severity } from '../rules/anomalies';
import { CHANNEL_LABEL, channelColor } from '../lib/colors';
import { useApp, type RangeDays } from '../state/AppContext';
import { IconArrowDown, IconArrowUp } from './icons';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ChannelBadge({ channel }: { channel: Channel }) {
  const { theme } = useApp();
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-300">
      <span className="h-2 w-2 rounded-full" style={{ background: channelColor(theme, channel) }} />
      {CHANNEL_LABEL[channel]}
    </span>
  );
}

const HEALTH_STYLE: Record<Health, { label: string; dot: string; pill: string }> = {
  good: { label: 'On target', dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20' },
  warning: { label: 'Near target', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20' },
  critical: { label: 'Off target', dot: 'bg-red-500', pill: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20' },
  inactive: { label: 'No delivery', dot: 'bg-zinc-400', pill: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-600/30' },
};

export function HealthPill({ health }: { health: Health }) {
  const s = HEALTH_STYLE[health];
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', s.pill)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

/** Text colour for a metric cell by health. */
export function healthText(h: Exclude<Health, 'inactive'>): string {
  return h === 'good'
    ? 'text-emerald-700 dark:text-emerald-400'
    : h === 'warning'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-red-600 dark:text-red-400';
}

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'bg-red-600 text-white dark:bg-red-500',
  high: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30',
  medium: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30',
  low: 'bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={cx('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', SEVERITY_STYLE[severity])}>
      {severity}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const style =
    status === 'ACTIVE'
      ? 'text-emerald-700 dark:text-emerald-400'
      : status === 'LEARNING'
        ? 'text-sky-700 dark:text-sky-400'
        : 'text-zinc-500 dark:text-zinc-400';
  return <span className={cx('text-xs font-medium', style)}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}

/** Change vs previous period. `goodWhenUp` decides colour; arrow shows direction. */
export function Delta({ value, goodWhenUp = true }: { value: number | null; goodWhenUp?: boolean | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-xs text-zinc-400">-</span>;
  const up = value >= 0;
  const flat = Math.abs(value) < 0.005;
  const good = flat || goodWhenUp === null ? null : up === goodWhenUp;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        good === null ? 'text-zinc-500' : good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
      )}
    >
      {up ? <IconArrowUp /> : <IconArrowDown />}
      {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}

const RANGE_OPTIONS: RangeDays[] = [7, 14, 30, 90];

export function RangePicker() {
  const { rangeDays, setRangeDays } = useApp();
  return (
    <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      {RANGE_OPTIONS.map((d) => (
        <button
          key={d}
          role="radio"
          aria-checked={rangeDays === d}
          onClick={() => setRangeDays(d)}
          className={cx(
            'rounded-md px-2.5 py-1 font-medium transition-colors',
            rangeDays === d
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
          )}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <label className="inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 rounded-lg border border-zinc-200 bg-white px-2.5 pr-8 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">{children}</div>;
}

export function StatCard({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'amber' | 'green' }) {
  const toneCls = tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'green' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-900 dark:text-zinc-50';
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', toneCls)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </Card>
  );
}
