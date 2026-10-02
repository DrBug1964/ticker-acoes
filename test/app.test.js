import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { QuoteStore } from '../src/store.js';

const store = new QuoteStore([{ symbol: 'A', name: 'Alpha', sector: 'pharma' }]);
store.applyResult('A', {
  price: 110, previousClose: 100, change: 10, changePct: 10,
  currency: 'USD', marketOpen: true, series: [100, 110],
});

let server;
let port;
test.before(async () => {
  server = createApp(store);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});
test.after(() => server.close());

// http.get (e não fetch) para enviar o caminho tal como está, sem normalização.
const get = (path) =>
  new Promise((resolve, reject) => {
    http.get({ port, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });

test('GET /api/quotes devolve cotações, setores e hora do servidor', async () => {
  const res = await get('/api/quotes');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const json = JSON.parse(res.body);
  assert.equal(typeof json.serverTime, 'number');
  assert.equal(json.sectors.length, 4);
  assert.equal(json.quotes[0].symbol, 'A');
  assert.equal(json.quotes[0].price, 110);
});

test('GET / serve a página', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
});

test('GET /format.js serve o módulo como JavaScript', async () => {
  const res = await get('/format.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/javascript/);
});

test('ficheiro inexistente ou tipo não servido dá 404', async () => {
  assert.equal((await get('/nao-existe.js')).status, 404);
  assert.equal((await get('/nope.txt')).status, 404);
});

test('não serve ficheiros fora de public/', async () => {
  assert.equal((await get('/..%2fpackage.json')).status, 404);
  assert.equal((await get('/..%2f..%2f..%2fetc%2fpasswd')).status, 404);
});
