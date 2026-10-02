import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch, createYahooProvider } from '../src/providers/yahoo.js';
import {
  parseQuote, isUsListing, createFinnhubProvider,
} from '../src/providers/finnhub.js';
import { createProvider, PROVIDER_INFO } from '../src/providers/index.js';

const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

const yahooSearch = {
  quotes: [
    { symbol: '005930.KS', exchange: 'KSC', quoteType: 'EQUITY', shortname: 'SamsungElec', longname: 'Samsung Electronics Co., Ltd.' },
    { symbol: 'SSNLF', exchange: 'PNK', quoteType: 'EQUITY', shortname: 'SAMSUNG ELECTRONICS CO' },
    { symbol: 'SMSN.IL', exchange: 'IOB', quoteType: 'EQUITY', shortname: 'SAMSUNG GDR' },
    { symbol: 'MU', exchange: 'NMS', quoteType: 'EQUITY', shortname: 'Micron Technology, Inc.' },
    { symbol: 'SPY', exchange: 'PCX', quoteType: 'ETF', shortname: 'SPDR S&P 500' },
    { symbol: 'XYZ=F', exchange: 'CME', quoteType: 'FUTURE', shortname: 'Futuro' },
  ],
};

test('parseSearch (todos): só ações/ETF de mercados suportados, com nome longo se existir', () => {
  assert.deepEqual(parseSearch(yahooSearch).map((r) => r.symbol), ['005930.KS', 'MU', 'SPY']);
  assert.equal(parseSearch(yahooSearch)[0].name, 'Samsung Electronics Co., Ltd.');
  assert.equal(parseSearch(yahooSearch)[1].name, 'Micron Technology, Inc.');
});

test('parseSearch filtra por mercado', () => {
  assert.deepEqual(parseSearch(yahooSearch, 'kr').map((r) => r.symbol), ['005930.KS']);
  assert.deepEqual(parseSearch(yahooSearch, 'us').map((r) => r.symbol), ['MU', 'SPY']);
  assert.deepEqual(parseSearch(yahooSearch, 'pt'), []);
});

test('parseSearch lança com resposta inválida', () => {
  assert.throws(() => parseSearch({}), /inválida/);
});

test('yahoo.search pede o texto codificado e mais resultados quando há filtro', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return res(yahooSearch); };
  const p = createYahooProvider({ fetchImpl });
  assert.equal((await p.search('micron & co', 'all')).length, 3);
  await p.search('micron', 'kr');
  assert.match(urls[0], /q=micron%20%26%20co&quotesCount=15&newsCount=0$/);
  assert.match(urls[1], /quotesCount=25/);
});

test('yahoo.search: 429 marca rateLimited; outros erros dão HTTP <código>', async () => {
  const p429 = createYahooProvider({ fetchImpl: async () => res({}, 429) });
  await assert.rejects(p429.search('x'), (e) => e.rateLimited === true);
  const p500 = createYahooProvider({ fetchImpl: async () => res({}, 500) });
  await assert.rejects(p500.search('x'), /HTTP 500/);
});

test('yahoo provider: refreshMs fixo, todos os mercados', () => {
  const p = createYahooProvider({ fetchImpl: async () => res({}) });
  assert.equal(p.refreshMs(1), 30_000);
  assert.equal(p.refreshMs(30), 30_000);
  assert.equal(p.id, 'yahoo');
  assert.equal(p.markets.length, 9);
});

// ---- Finnhub

test('finnhub parseQuote calcula variação e rejeita zeros (símbolo desconhecido)', () => {
  const q = parseQuote({ c: 110, pc: 100 }, true);
  assert.deepEqual(q, {
    price: 110, previousClose: 100, change: 10, changePct: 10,
    currency: 'USD', marketOpen: true, series: [],
  });
  assert.throws(() => parseQuote({ c: 0, pc: 0 }, false), /sem dados/);
  assert.throws(() => parseQuote({}, false), /sem dados/);
});

test('isUsListing exclui símbolos de outras bolsas mas aceita classes A/B', () => {
  assert.equal(isUsListing('NVDA'), true);
  assert.equal(isUsListing('BRK.B'), true);
  assert.equal(isUsListing('BP.L'), false);
  assert.equal(isUsListing('005930.KS'), false);
});

function finnhubFake(counts = {}) {
  return async (url, opts) => {
    const path = new URL(url).pathname;
    counts[path] = (counts[path] ?? 0) + 1;
    counts.headers = opts?.headers;
    counts.lastUrl = url;
    if (path.endsWith('/quote')) return res({ c: 110, pc: 100 });
    if (path.endsWith('/stock/market-status')) return res({ isOpen: true });
    if (path.endsWith('/search')) {
      return res({ result: [
        { symbol: 'MU', description: 'MICRON TECHNOLOGY INC', type: 'Common Stock' },
        { symbol: 'MU.L', description: 'MICRON LONDON', type: 'Common Stock' },
        { symbol: 'BRK.B', description: 'BERKSHIRE HATHAWAY INC-CL B', type: 'Common Stock' },
      ] });
    }
    return res({}, 404);
  };
}

test('finnhub.quote usa o cabeçalho da chave (nunca o URL) e o estado do mercado', async () => {
  const counts = {};
  const p = createFinnhubProvider({ apiKey: 'SEGREDO', fetchImpl: finnhubFake(counts) });
  const q = await p.quote('MU');
  assert.equal(q.price, 110);
  assert.equal(q.marketOpen, true);
  assert.equal(counts.headers['X-Finnhub-Token'], 'SEGREDO');
  assert.doesNotMatch(counts.lastUrl, /SEGREDO/);
});

test('finnhub: cotações em paralelo partilham um único pedido de estado do mercado', async () => {
  const counts = {};
  const p = createFinnhubProvider({ apiKey: 'k', fetchImpl: finnhubFake(counts) });
  await Promise.all(['A', 'B', 'C'].map((s) => p.quote(s)));
  assert.equal(counts['/api/v1/stock/market-status'], 1);
  assert.equal(counts['/api/v1/quote'], 3);
});

test('finnhub: o estado do mercado volta a ser pedido passados 60 s', async () => {
  const counts = {};
  let t = 0;
  const p = createFinnhubProvider({ apiKey: 'k', fetchImpl: finnhubFake(counts), now: () => t });
  await p.quote('A');
  t = 59_000;
  await p.quote('A');
  assert.equal(counts['/api/v1/stock/market-status'], 1);
  t = 61_000;
  await p.quote('A');
  assert.equal(counts['/api/v1/stock/market-status'], 2);
});

test('finnhub: falha do estado do mercado não impede a cotação', async () => {
  const fetchImpl = async (url) =>
    new URL(url).pathname.endsWith('/quote') ? res({ c: 5, pc: 4 }) : res({}, 500);
  const p = createFinnhubProvider({ apiKey: 'k', fetchImpl });
  const q = await p.quote('A');
  assert.equal(q.price, 5);
  assert.equal(q.marketOpen, false);
});

test('finnhub: sem chave, 401 e 429', async () => {
  const noKey = createFinnhubProvider({ apiKey: '', fetchImpl: finnhubFake() });
  await assert.rejects(noKey.quote('A'), /Falta a chave/);
  await assert.rejects(noKey.search('a'), /Falta a chave/);
  const bad = createFinnhubProvider({ apiKey: 'x', fetchImpl: async () => res({}, 401) });
  await assert.rejects(bad.quote('A'), /chave inválida/);
  const limited = createFinnhubProvider({ apiKey: 'x', fetchImpl: async () => res({}, 429) });
  await assert.rejects(limited.quote('A'), (e) => e.rateLimited === true);
});

test('finnhub.search: só EUA, filtra símbolos de outras bolsas, não pede nada para outros mercados', async () => {
  const counts = {};
  const p = createFinnhubProvider({ apiKey: 'k', fetchImpl: finnhubFake(counts) });
  const out = await p.search('micron', 'all');
  assert.deepEqual(out.map((r) => r.symbol), ['MU', 'BRK.B']);
  assert.deepEqual(out[0], { symbol: 'MU', name: 'MICRON TECHNOLOGY INC', market: 'us' });
  const before = counts['/api/v1/search'];
  assert.deepEqual(await p.search('samsung', 'kr'), []);
  assert.equal(counts['/api/v1/search'], before);
});

test('finnhub: refreshMs respeita 60 pedidos/minuto; só o mercado EUA', () => {
  const p = createFinnhubProvider({ apiKey: 'k', fetchImpl: finnhubFake() });
  assert.equal(p.refreshMs(5), 30_000);
  assert.equal(p.refreshMs(30), 37_200);
  assert.deepEqual(p.markets.map((m) => m.id), ['us']);
});

test('createProvider escolhe a fonte e PROVIDER_INFO descreve-as', () => {
  assert.equal(createProvider('yahoo').id, 'yahoo');
  assert.equal(createProvider('finnhub', { apiKey: 'k' }).id, 'finnhub');
  assert.equal(createProvider('qualquer-coisa').id, 'yahoo');
  assert.deepEqual(PROVIDER_INFO.map((p) => p.id), ['yahoo', 'finnhub']);
});
