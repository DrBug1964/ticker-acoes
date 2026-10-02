import { marketById } from '../markets.js';

const BASE = 'https://finnhub.io/api/v1';
const STATUS_TTL_MS = 60_000;
const US = marketById('us');

export function parseQuote(json, isOpen) {
  const price = json?.c;
  const previousClose = json?.pc;
  if (!Number.isFinite(price) || !Number.isFinite(previousClose) || price <= 0 || previousClose <= 0) {
    throw new Error('símbolo sem dados');
  }
  const change = price - previousClose;
  return {
    price,
    previousClose,
    change,
    changePct: (change / previousClose) * 100,
    currency: 'USD',
    marketOpen: Boolean(isOpen),
    series: [],
  };
}

// Símbolos com sufixo de bolsa (BP.L, 005930.KS) não são cotações dos EUA; BRK.B e afins são.
export const isUsListing = (symbol) => !symbol.includes('.') || /^[A-Z]+\.[AB]$/.test(symbol);

export function createFinnhubProvider({ apiKey, fetchImpl = fetch, now = () => Date.now() }) {
  async function get(path, params = {}) {
    if (!apiKey) throw new Error('Falta a chave do Finnhub');
    const url = `${BASE}${path}?${new URLSearchParams(params)}`;
    const res = await fetchImpl(url, {
      headers: { 'X-Finnhub-Token': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) {
      const err = new Error('limite de pedidos');
      err.rateLimited = true;
      throw err;
    }
    if (res.status === 401 || res.status === 403) throw new Error('chave inválida ou sem permissão');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  let status = null; // { at, promise }
  function marketOpen() {
    if (!status || now() - status.at >= STATUS_TTL_MS) {
      status = {
        at: now(),
        promise: get('/stock/market-status', { exchange: 'US' })
          .then((json) => Boolean(json?.isOpen))
          .catch(() => false),
      };
    }
    return status.promise;
  }

  return {
    id: 'finnhub',
    markets: [US],
    refreshMs: (n) => Math.max(30_000, Math.ceil(((n + 1) / 50) * 60_000)),
    async quote(symbol) {
      const [json, open] = await Promise.all([get('/quote', { symbol }), marketOpen()]);
      return parseQuote(json, open);
    },
    async search(query, marketId = 'all') {
      if (marketId !== 'all' && marketId !== 'us') return [];
      const json = await get('/search', { q: query });
      return (json?.result ?? [])
        .filter((r) => r.symbol && isUsListing(r.symbol))
        .slice(0, 15)
        .map((r) => ({ symbol: r.symbol, name: r.description || r.symbol, market: 'us' }));
    },
  };
}
