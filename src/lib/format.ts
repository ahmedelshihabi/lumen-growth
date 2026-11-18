// Number/money formatting. Locale follows the UI language (set by I18nProvider);
// currency follows the loaded ad accounts (set by AppProvider).
const locale = 'en-US';
let currency = 'USD';

let money0: Intl.NumberFormat;
let money2: Intl.NumberFormat;
let compact: Intl.NumberFormat;
let int: Intl.NumberFormat;

function build() {
  money0 = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
  money2 = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  int = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
}
build();


export function setDisplayCurrency(c: string) {
  if (!c || c === currency) return;
  currency = c;
  build();
}

export const getDisplayCurrency = () => currency;

export const fmtMoney = (n: number) => money0.format(n);
export const fmtMoney2 = (n: number) => money2.format(n);
export const fmtMoneyCompact = (n: number) =>
  Math.abs(n) >= 10_000
    ? new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(n)
    : money0.format(n);
export const fmtInt = (n: number) => int.format(n);
export const fmtCompact = (n: number) => compact.format(n);
export const fmtPct = (n: number, digits = 2) => `${(n * 100).toFixed(digits)}%`;
export const fmtRoas = (n: number) => `${n.toFixed(2)}x`;
export const fmtSignedPct = (n: number, digits = 1) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;

/**
 * Rough units of each currency per 1 USD, used ONLY to scale rule thresholds
 * (minimum spend, priority bands) so "500" doesn't mean $500 in one account and
 * EGP 500 (~$10) in another. Never used to convert amounts shown to the user.
 */
const USD_SCALE: Record<string, number> = {
  USD: 1, EUR: 0.9, GBP: 0.8, EGP: 50, SAR: 3.75, AED: 3.67, QAR: 3.64, KWD: 0.31, BHD: 0.38, OMR: 0.38, JOD: 0.71,
};
export const currencyScale = (c: string = currency) => USD_SCALE[c.toUpperCase()] ?? 1;
