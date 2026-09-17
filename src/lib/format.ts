const nf = new Intl.NumberFormat('he-IL');

/**
 * The sign goes outside the currency symbol. Letting Intl place it produces
 * "₪-6,704", which in an RTL line renders with the minus adrift from the number.
 */
export function shekel(n: number): string {
  const rounded = Math.round(n);
  return `${rounded < 0 ? '-' : ''}₪${nf.format(Math.abs(rounded))}`;
}

export function shortShekel(n: number): string {
  if (n < 0) return `-${shortShekel(-n)}`;
  if (n >= 1_000_000) return `₪${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2).replace(/\.?0+$/, '')}M`;
  if (n >= 1000) return `₪${Math.round(n / 1000)}K`;
  return shekel(n);
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** Percentages without a trailing ".0" — bracket rates read badly as "8.0%". */
export function ratePct(x: number): string {
  return `${(x * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export function signedPct(x: number): string {
  const v = Math.round(x * 100);
  return `${v > 0 ? '+' : ''}${v}%`;
}

export function num(n: number): string {
  return nf.format(n);
}

/**
 * Hebrew count phrasing. "1 הערות אזהרה" is wrong, and this text goes into a
 * document a lawyer reads.
 */
export function count(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : `${nf.format(n)} ${plural}`;
}
