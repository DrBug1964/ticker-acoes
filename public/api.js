async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // resposta sem corpo JSON
  }
  if (!res.ok) {
    const err = new Error(json?.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const getQuotes = () => call('GET', '/api/quotes');
export const search = (q, market) =>
  call('GET', `/api/search?q=${encodeURIComponent(q)}&market=${encodeURIComponent(market)}`);
export const putWatchlist = (items) => call('PUT', '/api/watchlist', { items });
export const getSettings = () => call('GET', '/api/settings');
export const putSettings = (update) => call('PUT', '/api/settings', update);
