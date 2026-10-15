/**
 * Font size that lets a run of display type fill the column without
 * overflowing it: Anton's glyphs average about half an em wide, so the size
 * is the column width over half the character count, capped at `max`.
 */
/** Dollars without cents: the huge number is a headline, not a ledger. */
export function wholeUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function fitDisplay(text: string, max = 236, columnFraction = 1): string {
  const units = Math.max(1.6, [...text].reduce((sum, ch) => sum + (/[,.]/.test(ch) ? 0.22 : 0.52), 0));
  const column = `min(100vw - 32px, 688px) * ${columnFraction}`;
  return `min(${max}px, calc(${column} / ${units.toFixed(2)}))`;
}
