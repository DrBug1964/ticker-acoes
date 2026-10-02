const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

export function parseChart(json, now = Date.now() / 1000) {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description ?? 'resposta sem dados');

  const meta = result.meta ?? {};
  const price = meta.regularMarketPrice;
  const previousClose = meta.chartPreviousClose ?? meta.previousClose;
  if (!Number.isFinite(price) || !Number.isFinite(previousClose) || previousClose === 0) {
    throw new Error('preço ou fecho anterior inválidos');
  }

  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const series = closes.filter(Number.isFinite);
  const regular = meta.currentTradingPeriod?.regular;
  const marketOpen = Boolean(regular) && now >= regular.start && now < regular.end;
  const change = price - previousClose;

  return {
    price,
    previousClose,
    change,
    changePct: (change / previousClose) * 100,
    currency: meta.currency ?? 'USD',
    marketOpen,
    series,
  };
}

export async function fetchChart(symbol, fetchImpl = fetch) {
  const url = `${BASE}${encodeURIComponent(symbol)}?range=1d&interval=5m`;
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
  return parseChart(await res.json());
}
