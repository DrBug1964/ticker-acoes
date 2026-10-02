const MAX_DELAY_MS = 300_000;

export class QuoteStore {
  constructor(tickers, now = () => Date.now()) {
    this.now = now;
    this.entries = new Map(
      tickers.map((t) => [t.symbol, { ...t, data: null, updatedAt: null, error: null }]),
    );
  }

  applyResult(symbol, quote) {
    const e = this.entries.get(symbol);
    e.data = quote;
    e.updatedAt = this.now();
    e.error = null;
  }

  applyError(symbol, err) {
    this.entries.get(symbol).error = err.message;
  }

  snapshot() {
    return [...this.entries.values()].map((e) => ({
      symbol: e.symbol,
      name: e.name,
      sector: e.sector,
      hasData: e.data !== null,
      stale: e.data !== null && e.error !== null,
      error: e.error,
      updatedAt: e.updatedAt,
      ...(e.data ?? {}),
    }));
  }
}

export async function refreshAll(tickers, fetchFn, store) {
  const results = await Promise.allSettled(tickers.map((t) => fetchFn(t.symbol)));
  let rateLimited = false;
  const failed = [];
  results.forEach((r, i) => {
    const symbol = tickers[i].symbol;
    if (r.status === 'fulfilled') {
      store.applyResult(symbol, r.value);
    } else {
      store.applyError(symbol, r.reason);
      failed.push(symbol);
      if (r.reason?.rateLimited) rateLimited = true;
    }
  });
  return { rateLimited, failed };
}

export function nextDelay(current, rateLimited, base) {
  return rateLimited ? Math.min(current * 2, MAX_DELAY_MS) : base;
}
