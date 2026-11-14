import type { TooltipProps } from 'recharts';

interface Props extends TooltipProps<number, string> {
  formatValue?: (v: number, name: string) => string;
  formatLabel?: (l: string) => string;
}

/** Shared tooltip: label on top, one row per series with a colour key; text stays in ink colours. */
export function ChartTooltip({ active, payload, label, formatValue, formatLabel }: Props) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[160px] rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      {label !== undefined && (
        <div className="mb-1.5 font-medium text-zinc-900 dark:text-zinc-100">{formatLabel ? formatLabel(String(label)) : label}</div>
      )}
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
              <span className="h-2 w-2 rounded-sm" style={{ background: p.color ?? (p.payload as { fill?: string })?.fill }} />
              {p.name}
            </span>
            <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatValue ? formatValue(Number(p.value), String(p.name)) : p.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
