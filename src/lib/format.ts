const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const fmtMoney = (n: number) => usd0.format(n);
export const fmtMoney2 = (n: number) => usd2.format(n);
export const fmtMoneyCompact = (n: number) => (Math.abs(n) >= 10_000 ? `$${compact.format(n)}` : usd0.format(n));
export const fmtInt = (n: number) => int.format(n);
export const fmtCompact = (n: number) => compact.format(n);
export const fmtPct = (n: number, digits = 2) => `${(n * 100).toFixed(digits)}%`;
export const fmtRoas = (n: number) => `${n.toFixed(2)}x`;
export const fmtSignedPct = (n: number, digits = 1) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
