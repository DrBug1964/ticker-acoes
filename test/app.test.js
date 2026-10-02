import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { createService } from '../src/service.js';
import { saveSettings } from '../src/settings.js';
import { fakeProvider, tmpSettingsFile } from './helpers.js';

const file = tmpSettingsFile();
saveSettings(file, {
  version: 1, provider: 'yahoo', apiKey: '',
  watchlist: [{ symbol: 'A', name: 'Alpha', market: 'us' }],
});
let provider = fakeProvider();
const service = createService({ settingsFile: file, makeProvider: () => provider });

let server;
let port;
test.before(async () => {
  server = createApp(service);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  await service.refresh();
});
test.after(() => server.close());

// http.request (e não fetch) para controlar o caminho e os cabeçalhos tal como são.
function request(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ port, host: '127.0.0.1', method, path, headers: {
      ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* não é JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

test('GET /api/quotes devolve grupos por mercado', async () => {
  const res = await request('GET', '/api/quotes');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.json.groups[0].market, 'us');
  assert.equal(res.json.groups[0].quotes[0].symbol, 'A');
  assert.equal(res.json.groups[0].quotes[0].price, 110);
  assert.equal(typeof res.json.serverTime, 'number');
});

test('GET /api/search valida e devolve resultados com o nome do mercado', async () => {
  const bad = await request('GET', '/api/search?q=a&market=all');
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /2 caracteres/);
  const unknown = await request('GET', '/api/search?q=micron&market=zz');
  assert.equal(unknown.status, 400);
  const ok = await request('GET', '/api/search?q=micron&market=all');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.results[0].symbol, 'MU');
  assert.ok(ok.json.results[0].marketLabel);
});

test('GET /api/search: falha da fonte dá 502 e limite dá 429', async () => {
  const keep = provider;
  provider = fakeProvider({ search: async () => { throw new Error('HTTP 500'); } });
  // o serviço guardou a fonte antiga: forçar a troca de fonte para usar a nova
  service.updateSettings({ provider: 'finnhub' });
  const failing = await request('GET', '/api/search?q=micron');
  assert.equal(failing.status, 502);
  assert.match(failing.json.error, /HTTP 500/);

  provider = fakeProvider({
    search: async () => { const e = new Error('limite'); e.rateLimited = true; throw e; },
  });
  service.updateSettings({ provider: 'yahoo' });
  const limited = await request('GET', '/api/search?q=micron');
  assert.equal(limited.status, 429);

  provider = keep;
  service.updateSettings({ provider: 'yahoo' });
});

test('PUT /api/watchlist guarda; GET devolve; inválidos dão 400 e não alteram', async () => {
  const put = await request('PUT', '/api/watchlist', {
    body: { items: [{ symbol: 'mu', name: 'Micron', market: 'us' }] },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.json.items, [{ symbol: 'MU', name: 'Micron', market: 'us' }]);
  assert.deepEqual((await request('GET', '/api/watchlist')).json.items, put.json.items);

  const many = Array.from({ length: 31 }, (_, i) => ({ symbol: `S${i}`, name: 'x', market: 'us' }));
  assert.equal((await request('PUT', '/api/watchlist', { body: { items: many } })).status, 400);
  assert.equal((await request('PUT', '/api/watchlist', { body: { items: [{ symbol: 'A', market: 'zz' }] } })).status, 400);
  assert.equal((await request('PUT', '/api/watchlist', { body: '{não é json' })).status, 400);
  assert.equal((await request('PUT', '/api/watchlist', { body: { semItems: true } })).status, 400);
  assert.deepEqual((await request('GET', '/api/watchlist')).json.items, put.json.items);
});

test('PUT com corpo demasiado grande dá 400', async () => {
  const big = JSON.stringify({ items: [], lixo: 'x'.repeat(70 * 1024) });
  assert.equal((await request('PUT', '/api/watchlist', { body: big })).status, 400);
});

test('PUT /api/settings: a chave guarda-se mas nunca é devolvida', async () => {
  const put = await request('PUT', '/api/settings', { body: { provider: 'finnhub', apiKey: 'SEGREDO123' } });
  assert.equal(put.status, 200);
  assert.equal(put.json.hasKey, true);
  const get = await request('GET', '/api/settings');
  assert.equal(get.json.provider, 'finnhub');
  assert.doesNotMatch(get.text, /SEGREDO123/);
  assert.doesNotMatch((await request('GET', '/api/quotes')).text, /SEGREDO123/);
  assert.equal((await request('PUT', '/api/settings', { body: { provider: 'bogus' } })).status, 400);
  await request('PUT', '/api/settings', { body: { provider: 'yahoo' } });
});

test('recusa pedidos com Origin ou Host que não sejam locais', async () => {
  const evilOrigin = await request('PUT', '/api/watchlist', {
    body: { items: [] }, headers: { Origin: 'http://evil.example' },
  });
  assert.equal(evilOrigin.status, 403);
  assert.equal((await request('GET', '/api/quotes', { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await request('GET', '/api/quotes', { headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await request('GET', '/api/quotes', { headers: { Host: `evil.example:${port}` } })).status, 403);
  const sameOrigin = await request('GET', '/api/quotes', { headers: { Origin: `http://127.0.0.1:${port}` } });
  assert.equal(sameOrigin.status, 200);
  assert.equal((await request('GET', '/api/quotes', { headers: { Host: `localhost:${port}` } })).status, 200);
});

test('rota desconhecida dá 404 em JSON', async () => {
  assert.equal((await request('GET', '/api/nada')).status, 404);
});

test('GET / serve a página e /format.js o módulo', async () => {
  const page = await request('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  const js = await request('GET', '/format.js');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /text\/javascript/);
});

test('ficheiro inexistente ou tipo não servido dá 404; nada fora de public/', async () => {
  assert.equal((await request('GET', '/nao-existe.js')).status, 404);
  assert.equal((await request('GET', '/nope.txt')).status, 404);
  assert.equal((await request('GET', '/..%2fpackage.json')).status, 404);
  assert.equal((await request('GET', '/..%2f..%2f..%2fetc%2fpasswd')).status, 404);
  assert.equal((await request('GET', '/src/app.js')).status, 404);
});
