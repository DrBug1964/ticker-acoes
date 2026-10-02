const SYMBOLS = { USD: '$', KRW: '₩', DKK: 'kr ', EUR: '€' };

const nf = (digits) =>
  new Intl.NumberFormat('pt-PT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const digitsFor = (currency) => (currency === 'KRW' ? 0 : 2);
const symbolFor = (currency) => SYMBOLS[currency] ?? `${currency} `;
const roundTo = (n, digits) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const signOf = (rounded) => (rounded > 0 ? '+' : rounded < 0 ? '-' : '');

export function formatPrice(value, currency) {
  return symbolFor(currency) + nf(digitsFor(currency)).format(value);
}

export function formatPct(pct) {
  const r = roundTo(pct, 2);
  return `${signOf(r)}${nf(2).format(Math.abs(r))}%`;
}

export function formatChange(change, currency) {
  const d = digitsFor(currency);
  const r = roundTo(change, d);
  return `${signOf(r)}${symbolFor(currency)}${nf(d).format(Math.abs(r))}`;
}

export function direction(pct) {
  const r = roundTo(pct, 2);
  return r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
}

export function ageText(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `há ${s} s` : `há ${Math.floor(s / 60)} min`;
}

export function sparkPoints(series, w, h, pad = 2) {
  if (series.length < 2) return '';
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;
  return series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = span === 0 ? h / 2 : pad + (1 - (v - min) / span) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
