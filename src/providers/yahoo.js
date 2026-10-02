import { fetchChart } from '../yahoo.js';
import { MARKETS, marketForExchange } from '../markets.js';

const SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';

export function parseSearch(json, marketId = 'all') {
  const quotes = json?.quotes;
  if (!Array.isArray(quotes)) throw new Error('resposta de pesquisa inválida');
  const out = [];
  for (const q of quotes) {
    if (!['EQUITY', 'ETF'].includes(q.quoteType) || !q.symbol) continue;
    const market = marketForExchange(q.exchange);
    if (!market) continue;
    if (marketId !== 'all' && market !== marketId) continue;
    out.push({ symbol: q.symbol, name: (q.longname || q.shortname || q.symbol).trim(), market });
  }
  return out;
}

export function createYahooProvider({ fetchImpl = fetch } = {}) {
  return {
    id: 'yahoo',
    markets: MARKETS,
    refreshMs: () => 30_000,
    quote: (symbol) => fetchChart(symbol, fetchImpl),
    async search(query, marketId = 'all') {
      const count = marketId === 'all' ? 15 : 25;
      const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&quotesCount=${count}&newsCount=0`;
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 429) {
        const err = new Error('limite de pedidos');
        err.rateLimited = true;
        throw err;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseSearch(await res.json(), marketId);
    },
  };
}
