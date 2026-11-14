import type { ISODate } from '../data/types';

const DAY = 86_400_000;

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function parseISO(s: ISODate): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function addDays(s: ISODate, n: number): ISODate {
  return toISO(new Date(parseISO(s).getTime() + n * DAY));
}

/** a - b in whole days */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / DAY);
}

export function daysInMonth(s: ISODate): number {
  const d = parseISO(s);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function startOfMonth(s: ISODate): ISODate {
  return `${s.slice(0, 7)}-01`;
}

/** Viewer's local calendar date as ISO. */
export function localToday(): ISODate {
  const d = new Date();
  return toISO(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}

let dateLocale = 'en-US';
/** Set by I18nProvider when the UI language changes. */
export function setDateLocale(l: string) {
  dateLocale = l;
}

export function formatShortDate(s: ISODate): string {
  return parseISO(s).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatMonth(s: ISODate): string {
  return parseISO(s).toLocaleDateString(dateLocale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Localised date for timestamps (billing, sync times). */
export function formatDateTime(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString(dateLocale, { dateStyle: 'medium' });
}
