/**
 * CSV export that opens correctly in Excel (UTF-8 BOM so Arabic is readable) and keeps
 * numbers as numbers. Cells starting with = + - @ are prefixed with ' so a campaign name
 * can never run as a spreadsheet formula (CSV injection).
 */
export type CsvCell = string | number | null | undefined;

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, header: string[], rows: CsvCell[][]): void {
  const blob = new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
