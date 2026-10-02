import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChart, fetchChart } from '../src/yahoo.js';

const chart = ({ meta = {}, closes = [100, null, 105, 110] } = {}) => ({
  chart: {
    result: [{
      meta: {
        currency: 'USD',
        regularMarketPrice: 110,
        chartPreviousClose: 100,
        currentTradingPeriod: { regular: { start: 1000, end: 2000 } },
        ...meta,
      },
      timestamp: closes.map((_, i) => i),
      indicators: { quote: [{ close: closes }] },
    }],
    error: null,
  },
});

test('parseChart extrai preço, variação, moeda e série', () => {
  const q = parseChart(chart(), 1500);
  assert.equal(q.price, 110);
  assert.equal(q.previousClose, 100);
  assert.equal(q.change, 10);
  assert.equal(q.changePct, 10);
  assert.equal(q.currency, 'USD');
  assert.deepEqual(q.series, [100, 105, 110]);
});

test('parseChart ignora pontos null da série', () => {
  const q = parseChart(chart({ closes: [null, 101, null, null, 103] }), 1500);
  assert.deepEqual(q.series, [101, 103]);
});

test('parseChart: marketOpen depende do período regular', () => {
  assert.equal(parseChart(chart(), 1500).marketOpen, true);
  assert.equal(parseChart(chart(), 999).marketOpen, false);
  assert.equal(parseChart(chart(), 2000).marketOpen, false);
});

test('parseChart lança com resposta de erro do Yahoo', () => {
  const body = { chart: { result: null, error: { description: 'No data found' } } };
  assert.throws(() => parseChart(body), /No data found/);
});

test('parseChart lança com preço ou fecho anterior inválidos', () => {
  assert.throws(() => parseChart(chart({ meta: { regularMarketPrice: null } })), /inválid/);
  assert.throws(() => parseChart(chart({ meta: { chartPreviousClose: 0 } })), /inválid/);
  assert.throws(() => parseChart(chart({ meta: { chartPreviousClose: undefined } })), /inválid/);
});

test('fetchChart devolve a cotação e pede o símbolo codificado', async () => {
  let requested;
  const fake = async (url) => {
    requested = url;
    return { ok: true, status: 200, json: async () => chart() };
  };
  const q = await fetchChart('000660.KS', fake);
  assert.equal(q.price, 110);
  assert.match(requested, /\/chart\/000660\.KS\?range=1d&interval=5m$/);
});

test('fetchChart marca rateLimited em HTTP 429', async () => {
  const fake = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(fetchChart('X', fake), (e) => e.rateLimited === true);
});

test('fetchChart lança HTTP <código> em outros erros', async () => {
  const fake = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(fetchChart('X', fake), /HTTP 500/);
});
