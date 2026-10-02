import test from 'node:test';
import assert from 'node:assert/strict';
import { QuoteStore, refreshAll, nextDelay } from '../src/store.js';

const tickers = [
  { symbol: 'A', name: 'Alpha', sector: 'pharma' },
  { symbol: 'B', name: 'Beta', sector: 'nuclear' },
];
const quote = (price) => ({
  price, previousClose: 100, change: price - 100, changePct: price - 100,
  currency: 'USD', marketOpen: true, series: [100, price],
});
const bySymbol = (store, symbol) => store.snapshot().find((e) => e.symbol === symbol);

test('sem dados: hasData false e não está desatualizado', () => {
  const store = new QuoteStore(tickers);
  const a = bySymbol(store, 'A');
  assert.equal(a.hasData, false);
  assert.equal(a.stale, false);
  assert.equal(a.name, 'Alpha');
});

test('applyResult guarda a cotação e a hora', () => {
  const store = new QuoteStore(tickers, () => 5000);
  store.applyResult('A', quote(110));
  const a = bySymbol(store, 'A');
  assert.equal(a.hasData, true);
  assert.equal(a.price, 110);
  assert.equal(a.updatedAt, 5000);
  assert.equal(a.stale, false);
});

test('applyError mantém o último valor bom e marca desatualizado', () => {
  const store = new QuoteStore(tickers);
  store.applyResult('A', quote(110));
  store.applyError('A', new Error('HTTP 500'));
  const a = bySymbol(store, 'A');
  assert.equal(a.price, 110);
  assert.equal(a.stale, true);
  assert.equal(a.error, 'HTTP 500');
});

test('applyResult depois de um erro limpa o estado desatualizado', () => {
  const store = new QuoteStore(tickers);
  store.applyResult('A', quote(110));
  store.applyError('A', new Error('x'));
  store.applyResult('A', quote(111));
  const a = bySymbol(store, 'A');
  assert.equal(a.price, 111);
  assert.equal(a.stale, false);
  assert.equal(a.error, null);
});

test('refreshAll: um ticker a falhar não afeta os outros', async () => {
  const store = new QuoteStore(tickers);
  const fetchFn = async (symbol) => {
    if (symbol === 'B') throw new Error('HTTP 404');
    return quote(120);
  };
  const out = await refreshAll(tickers, fetchFn, store);
  assert.equal(bySymbol(store, 'A').price, 120);
  assert.equal(bySymbol(store, 'B').hasData, false);
  assert.equal(bySymbol(store, 'B').error, 'HTTP 404');
  assert.deepEqual(out, { rateLimited: false, failed: ['B'] });
});

test('refreshAll sinaliza rateLimited', async () => {
  const store = new QuoteStore(tickers);
  const fetchFn = async () => {
    const e = new Error('limite');
    e.rateLimited = true;
    throw e;
  };
  const out = await refreshAll(tickers, fetchFn, store);
  assert.equal(out.rateLimited, true);
  assert.deepEqual(out.failed, ['A', 'B']);
});

test('nextDelay dobra em limite de pedidos, com teto, e repõe a base', () => {
  assert.equal(nextDelay(30000, false, 30000), 30000);
  assert.equal(nextDelay(30000, true, 30000), 60000);
  assert.equal(nextDelay(60000, true, 30000), 120000);
  assert.equal(nextDelay(240000, true, 30000), 300000);
  assert.equal(nextDelay(120000, false, 30000), 30000);
});
