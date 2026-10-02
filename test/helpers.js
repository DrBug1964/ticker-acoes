import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { marketById } from '../src/markets.js';

export const tmpSettingsFile = () =>
  join(mkdtempSync(join(tmpdir(), 'ticker-')), 'settings.json');

export const quoteOf = (price = 110) => ({
  price, previousClose: 100, change: price - 100, changePct: price - 100,
  currency: 'USD', marketOpen: true, series: [100, price],
});

export const fakeProvider = (over = {}) => ({
  id: 'fake',
  markets: [marketById('us'), marketById('kr')],
  refreshMs: () => 30_000,
  quote: async () => quoteOf(110),
  search: async () => [{ symbol: 'MU', name: 'Micron', market: 'us' }],
  ...over,
});

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
