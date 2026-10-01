# Ticker de Ações Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página web local com um ticker deslizante e uma grelha de cartões (com mini-gráfico do dia) para 12 ações de 4 setores, atualizada a cada 30 s com dados gratuitos do Yahoo Finance.

**Architecture:** Um servidor Node.js (sem dependências) consulta o Yahoo Finance (`v8/finance/chart`, um pedido por ticker, em paralelo), guarda o último valor bom por ticker e serve `GET /api/quotes` mais os ficheiros estáticos de `public/`. A página (HTML/CSS/JS puro, módulos ES) consulta a API a cada 30 s e atualiza o DOM no sítio.

**Tech Stack:** Node.js 22 (módulos ES, `node:test`, `fetch` nativo), HTML/CSS/JS sem frameworks, sem pacotes npm.

**Spec:** `docs/superpowers/specs/2026-10-01-ticker-acoes-design.md`

**Desvio ao spec (verificado em 2026-10-01):** o endpoint agrupado `v7/finance/quote` devolve `Unauthorized` sem chave. Usa-se `v8/finance/chart/<símbolo>?range=1d&interval=5m` (sem autenticação), um pedido por ticker em paralelo (12 por ciclo de 30 s). Devolve preço, fecho anterior, moeda, período de negociação e a série do dia.

## Global Constraints

- Node.js 22, sem dependências npm; só módulos nativos (`node:http`, `node:test`, `node:fs`, ...).
- Página sem frameworks nem fontes/scripts externos.
- Porta 3000 por defeito (`PORT` sobrepõe). Atualização a cada 30 s.
- Tickers (lista única em `src/tickers.js`): PFE, NVO, LLY (farmacêutico); CCJ, LEU, CEG (nuclear); MU, 000660.KS, 005930.KS (memória); NVDA, TSLA, SPCX (tecnologia e espaço).
- Cores de setor: farmacêutico azul, nuclear amarelo, memória violeta, tecnologia/espaço laranja. Verde/vermelho só para subida/descida.
- Texto da interface em português de Portugal. Números em fonte monoespaçada.
- Indicador "Atualizado há X s" fica amarelo após mais de 2 min sem dados novos. Servidor inacessível: "Sem ligação ao servidor".
- Preço mostrado na moeda de cada ação, com símbolo da moeda.
- Fora do âmbito: alertas, histórico de vários dias, contas, escolha de tickers pela interface, alojamento online.

## Review Focus

1. **Gaps com `null` na série do Yahoo** (a meio da sessão): o mini-gráfico e o preço não podem rebentar nem mostrar `NaN`. Coberto na Task 2.
2. **Um ticker falha, os outros não:** os restantes 11 continuam a atualizar; o que falhou mantém o último valor, marcado como desatualizado. Coberto na Task 3.
3. **Série com 0 ou 1 ponto, ou toda igual (mercado fechado/ação parada):** o mini-gráfico não pode dar divisão por zero; mostra linha a meio ou nada. Coberto na Task 1.
4. **Variação minúscula negativa (`-0,001%`):** deve mostrar `0,00%` sem sinal e sem cor de descida, nunca `-0,00%`. Coberto na Task 1.
5. **Pedidos a ficheiros fora de `public/` (`/..%2fpackage.json`):** devem dar 404. Coberto na Task 4.

---

### Task 1: Projeto, lista de tickers e formatação

**Files:**
- Create: `package.json`, `.gitignore`
- Create: `src/tickers.js`
- Create: `public/format.js`
- Test: `test/format.test.js`

**Interfaces:**
- Produces (`src/tickers.js`): `SECTORS: {id,label,color}[]`, `TICKERS: {symbol,name,sector}[]` (`sector` é um `SECTORS[].id`).
- Produces (`public/format.js`, funciona em Node e no browser): `formatPrice(value:number, currency:string):string`, `formatPct(pct:number):string`, `formatChange(change:number, currency:string):string`, `direction(pct:number):'up'|'down'|'flat'`, `ageText(seconds:number):string`, `sparkPoints(series:number[], w:number, h:number, pad?:number):string`.

- [ ] **Step 1: Criar `package.json` e `.gitignore`**

`package.json`:
```json
{
  "name": "ticker-acoes",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/*.test.js",
    "check:live": "node test/live.check.js"
  }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
```

- [ ] **Step 2: Escrever o teste que falha**

`test/format.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPrice, formatPct, formatChange, direction, ageText, sparkPoints,
} from '../public/format.js';

// Intl usa espaços não separáveis; normalizamos para comparar.
const norm = (s) => s.replace(/\s/g, ' ');

test('formatPrice usa símbolo e casas decimais da moeda', () => {
  assert.equal(norm(formatPrice(150.65, 'USD')), '$150,65');
  assert.equal(norm(formatPrice(1833000, 'KRW')), '₩1 833 000');
  assert.equal(norm(formatPrice(12, 'CHF')), 'CHF 12,00');
});

test('formatPct mostra sinal e duas casas', () => {
  assert.equal(formatPct(1.236), '+1,24%');
  assert.equal(formatPct(-0.5), '-0,50%');
  assert.equal(formatPct(0), '0,00%');
});

test('formatPct não mostra -0,00% para variação minúscula negativa', () => {
  assert.equal(formatPct(-0.001), '0,00%');
  assert.equal(formatPct(0.004), '0,00%');
});

test('formatChange mostra sinal e moeda', () => {
  assert.equal(norm(formatChange(0.21, 'USD')), '+$0,21');
  assert.equal(norm(formatChange(-20000, 'KRW')), '-₩20 000');
  assert.equal(norm(formatChange(0, 'USD')), '$0,00');
});

test('direction usa o valor arredondado', () => {
  assert.equal(direction(1.2), 'up');
  assert.equal(direction(-0.5), 'down');
  assert.equal(direction(-0.001), 'flat');
  assert.equal(direction(0), 'flat');
});

test('ageText', () => {
  assert.equal(ageText(5), 'há 5 s');
  assert.equal(ageText(59), 'há 59 s');
  assert.equal(ageText(60), 'há 1 min');
  assert.equal(ageText(150), 'há 2 min');
  assert.equal(ageText(-3), 'há 0 s');
});

test('sparkPoints mapeia a série para coordenadas SVG', () => {
  assert.equal(sparkPoints([1, 2, 3], 100, 20), '0.0,18.0 50.0,10.0 100.0,2.0');
});

test('sparkPoints: série igual dá linha a meio; 0 ou 1 ponto dá vazio', () => {
  assert.equal(sparkPoints([5, 5, 5], 100, 20), '0.0,10.0 50.0,10.0 100.0,10.0');
  assert.equal(sparkPoints([5], 100, 20), '');
  assert.equal(sparkPoints([], 100, 20), '');
});
```

- [ ] **Step 3: Correr o teste e confirmar que falha**

Run: `npm test`
Expected: FAIL (`Cannot find module '../public/format.js'`)

- [ ] **Step 4: Implementar `public/format.js`**

```js
const SYMBOLS = { USD: '$', KRW: '₩', DKK: 'kr ', EUR: '€' };

const nf = (digits) =>
  new Intl.NumberFormat('pt-PT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const digitsFor = (currency) => (currency === 'KRW' ? 0 : 2);
const symbolFor = (currency) => SYMBOLS[currency] ?? `${currency} `;
const roundTo = (n, digits) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const signOf = (rounded) => (rounded > 0 ? '+' : rounded < 0 ? '-' : '');

export function formatPrice(value, currency) {
  return symbolFor(currency) + nf(digitsFor(currency)).format(value);
}

export function formatPct(pct) {
  const r = roundTo(pct, 2);
  return `${signOf(r)}${nf(2).format(Math.abs(r))}%`;
}

export function formatChange(change, currency) {
  const d = digitsFor(currency);
  const r = roundTo(change, d);
  return `${signOf(r)}${symbolFor(currency)}${nf(d).format(Math.abs(r))}`;
}

export function direction(pct) {
  const r = roundTo(pct, 2);
  return r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
}

export function ageText(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `há ${s} s` : `há ${Math.floor(s / 60)} min`;
}

export function sparkPoints(series, w, h, pad = 2) {
  if (series.length < 2) return '';
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;
  return series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = span === 0 ? h / 2 : pad + (1 - (v - min) / span) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
```

- [ ] **Step 5: Criar `src/tickers.js`**

```js
export const SECTORS = [
  { id: 'pharma', label: 'Farmacêutico', color: '#4da3ff' },
  { id: 'nuclear', label: 'Nuclear', color: '#f5c542' },
  { id: 'memory', label: 'Memória', color: '#a78bfa' },
  { id: 'techspace', label: 'Tecnologia e espaço', color: '#fb923c' },
];

export const TICKERS = [
  { symbol: 'PFE', name: 'Pfizer', sector: 'pharma' },
  { symbol: 'NVO', name: 'Novo Nordisk', sector: 'pharma' },
  { symbol: 'LLY', name: 'Eli Lilly', sector: 'pharma' },
  { symbol: 'CCJ', name: 'Cameco', sector: 'nuclear' },
  { symbol: 'LEU', name: 'Centrus Energy', sector: 'nuclear' },
  { symbol: 'CEG', name: 'Constellation Energy', sector: 'nuclear' },
  { symbol: 'MU', name: 'Micron', sector: 'memory' },
  { symbol: '000660.KS', name: 'SK Hynix', sector: 'memory' },
  { symbol: '005930.KS', name: 'Samsung Electronics', sector: 'memory' },
  { symbol: 'NVDA', name: 'NVIDIA', sector: 'techspace' },
  { symbol: 'TSLA', name: 'Tesla', sector: 'techspace' },
  { symbol: 'SPCX', name: 'SpaceX', sector: 'techspace' },
];
```

- [ ] **Step 6: Correr os testes e confirmar que passam**

Run: `npm test`
Expected: PASS (8 testes)

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore src/tickers.js public/format.js test/format.test.js
git commit -m "feat: project scaffold, ticker list and formatting helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cliente do Yahoo Finance

**Files:**
- Create: `src/yahoo.js`
- Test: `test/yahoo.test.js`

**Interfaces:**
- Produces: `parseChart(json:object, now?:number /*segundos epoch*/): Quote`, onde `Quote = { price, previousClose, change, changePct, currency, marketOpen:boolean, series:number[] }`. Lança `Error` se a resposta for de erro ou os valores forem inválidos.
- Produces: `fetchChart(symbol:string, fetchImpl?:typeof fetch): Promise<Quote>`. Lança `Error` com `rateLimited = true` em HTTP 429; `Error('HTTP <código>')` nos outros erros.

- [ ] **Step 1: Escrever o teste que falha**

`test/yahoo.test.js`:
```js
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
```

- [ ] **Step 2: Correr o teste e confirmar que falha**

Run: `node --test test/yahoo.test.js`
Expected: FAIL (`Cannot find module '../src/yahoo.js'`)

- [ ] **Step 3: Implementar `src/yahoo.js`**

```js
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
```

- [ ] **Step 4: Correr os testes e confirmar que passam**

Run: `npm test`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add src/yahoo.js test/yahoo.test.js
git commit -m "feat: Yahoo Finance chart client" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Armazém de cotações e ciclo de atualização

**Files:**
- Create: `src/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes (Task 2): `Quote` de `parseChart`; uma função `fetchFn(symbol) => Promise<Quote>` (na prática `fetchChart`).
- Consumes (Task 1): `TICKERS` (`{symbol,name,sector}[]`).
- Produces: `class QuoteStore { constructor(tickers, now?=()=>Date.now()); applyResult(symbol, quote); applyError(symbol, err); snapshot(): Entry[] }` onde `Entry = { symbol, name, sector, hasData:boolean, stale:boolean, error:string|null, updatedAt:number|null, ...Quote }` (os campos de `Quote` só existem se `hasData`).
- Produces: `refreshAll(tickers, fetchFn, store): Promise<{ rateLimited:boolean, failed:string[] }>`.
- Produces: `nextDelay(current:number, rateLimited:boolean, base:number): number` (dobra até 300000 em limite de pedidos; volta a `base` caso contrário).

- [ ] **Step 1: Escrever o teste que falha**

`test/store.test.js`:
```js
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
```

- [ ] **Step 2: Correr o teste e confirmar que falha**

Run: `node --test test/store.test.js`
Expected: FAIL (`Cannot find module '../src/store.js'`)

- [ ] **Step 3: Implementar `src/store.js`**

```js
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
```

- [ ] **Step 4: Correr os testes e confirmar que passam**

Run: `npm test`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.js
git commit -m "feat: quote store with last-good fallback and refresh loop helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Servidor HTTP

**Files:**
- Create: `src/app.js`, `server.js`
- Create: `public/index.html` (placeholder mínimo; a Task 5 substitui)
- Test: `test/app.test.js`

**Interfaces:**
- Consumes (Task 3): `QuoteStore#snapshot()`, `refreshAll`, `nextDelay`. Consumes (Task 2): `fetchChart`. Consumes (Task 1): `SECTORS`, `TICKERS`.
- Produces: `createApp(store): http.Server`. `GET /api/quotes` → `200 application/json` com `{ serverTime:number, sectors:SECTORS, quotes:Entry[] }`. Ficheiros estáticos `.html/.css/.js` de `public/`; tudo o resto 404.

- [ ] **Step 1: Criar o placeholder `public/index.html`**

```html
<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><title>Ticker de Ações</title></head><body>Ticker</body></html>
```

- [ ] **Step 2: Escrever o teste que falha**

`test/app.test.js`:
```js
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
```

- [ ] **Step 3: Correr o teste e confirmar que falha**

Run: `node --test test/app.test.js`
Expected: FAIL (`Cannot find module '../src/app.js'`)

- [ ] **Step 4: Implementar `src/app.js`**

```js
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTORS } from './tickers.js';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...extra });
  res.end(body);
}

export function createApp(store) {
  return http.createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'text/plain; charset=utf-8', 'Pedido inválido');
    }

    if (pathname === '/api/quotes') {
      const body = JSON.stringify({
        serverTime: Date.now(),
        sectors: SECTORS,
        quotes: store.snapshot(),
      });
      return send(res, 200, 'application/json; charset=utf-8', body, { 'Cache-Control': 'no-store' });
    }

    const file = resolve(PUBLIC, `.${pathname === '/' ? '/index.html' : pathname}`);
    const type = TYPES[extname(file)];
    if (!file.startsWith(PUBLIC + sep) || !type) {
      return send(res, 404, 'text/plain; charset=utf-8', 'Não encontrado');
    }
    try {
      return send(res, 200, type, await readFile(file));
    } catch {
      return send(res, 404, 'text/plain; charset=utf-8', 'Não encontrado');
    }
  });
}
```

- [ ] **Step 5: Criar `server.js`**

```js
import { TICKERS } from './src/tickers.js';
import { QuoteStore, refreshAll, nextDelay } from './src/store.js';
import { fetchChart } from './src/yahoo.js';
import { createApp } from './src/app.js';

const PORT = Number(process.env.PORT) || 3000;
const BASE_MS = 30_000;

const store = new QuoteStore(TICKERS);
createApp(store).listen(PORT, () => console.log(`Ticker em http://localhost:${PORT}`));

let delay = BASE_MS;
async function loop() {
  const { rateLimited, failed } = await refreshAll(TICKERS, fetchChart, store);
  if (failed.length) {
    const reasons = failed.map((s) => `${s} (${store.entries.get(s).error})`).join(', ');
    console.warn(`${new Date().toLocaleTimeString('pt-PT')} falhou: ${reasons}`);
  }
  delay = nextDelay(delay, rateLimited, BASE_MS);
  setTimeout(loop, delay);
}
loop();
```

- [ ] **Step 6: Correr os testes e confirmar que passam**

Run: `npm test`
Expected: PASS (todos)

- [ ] **Step 7: Verificar o servidor a sério**

Run (num terminal): `node server.js`
Em outro: `curl -s localhost:3000/api/quotes | head -c 600`
Expected: JSON com `quotes` de 12 entradas; após ~2 s `hasData: true` e preços reais. Parar o servidor com Ctrl+C.

- [ ] **Step 8: Commit**

```bash
git add src/app.js server.js public/index.html test/app.test.js
git commit -m "feat: HTTP server with /api/quotes and static files" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Interface (faixa, grelha, mini-gráficos)

**Files:**
- Replace: `public/index.html`
- Create: `public/style.css`, `public/app.js`

**Interfaces:**
- Consumes (Task 4): `GET /api/quotes` → `{ serverTime, sectors:[{id,label,color}], quotes:[Entry] }`.
- Consumes (Task 1): `formatPrice, formatPct, formatChange, direction, ageText, sparkPoints` de `/format.js`.
- Produces: a página final. Sem lógica nova com testes automáticos (a lógica testável está em `format.js`); verificação manual no fim da tarefa.

- [ ] **Step 1: Substituir `public/index.html`**

```html
<!doctype html>
<html lang="pt-PT">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ticker de Ações</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="marquee" aria-label="Cotações em movimento">
    <div class="marquee-track" id="track"></div>
  </header>
  <main>
    <div class="topbar">
      <h1>Ticker de Ações</h1>
      <div id="status" class="status" data-level="warn">A carregar…</div>
    </div>
    <div id="grid"></div>
  </main>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Criar `public/style.css`**

```css
:root {
  --bg: #0b0e14;
  --panel: #131824;
  --line: #222a3b;
  --text: #e6eaf2;
  --muted: #8a94a8;
  --up: #22c55e;
  --down: #ef4444;
  --flat: #94a3b8;
  --warn: #f5b301;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
}

/* Faixa deslizante */
.marquee {
  overflow: hidden;
  white-space: nowrap;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}
.marquee-track {
  display: inline-flex;
  width: max-content;
  animation: scroll var(--dur, 60s) linear infinite;
}
.marquee:hover .marquee-track { animation-play-state: paused; }
.marquee-group { display: inline-flex; }
@keyframes scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
.tick {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 22px;
  font-family: var(--mono);
  font-size: 14px;
}
.tick .badge {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  color: #0b0e14;
  background: var(--accent);
}
.tick .sym { font-weight: 700; }
.tick .px { padding: 0 3px; border-radius: 3px; }

/* Cor por direção */
[data-dir="up"] { --dir: var(--up); }
[data-dir="down"] { --dir: var(--down); }
.pct, .chg { color: var(--dir, var(--flat)); }
[data-dir="up"] .pct::before { content: "▲ "; }
[data-dir="down"] .pct::before { content: "▼ "; }

/* Página */
main { max-width: 1100px; margin: 0 auto; padding: 20px 16px 48px; }
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
}
h1 { font-size: 20px; margin: 0; }
.status { font-family: var(--mono); font-size: 13px; color: var(--muted); }
.status[data-level="warn"] { color: var(--warn); }
.status[data-level="error"] { color: var(--down); }

.sector { margin-top: 24px; }
.sector h2 {
  margin: 0 0 10px;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
}
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.card {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
}
.card.stale { opacity: 0.6; }
.card-head { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--muted); }
.card-head .name { color: var(--text); font-weight: 600; }
.price { margin: 0 -4px; padding: 2px 4px; border-radius: 4px; font-family: var(--mono); font-size: 26px; font-weight: 700; }
.row { display: flex; gap: 10px; font-family: var(--mono); font-size: 13px; }
.foot { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--muted); }
.state::before {
  content: "";
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--flat);
}
.card[data-open="true"] .state::before { background: var(--up); }
.spark { width: 120px; height: 32px; }
.spark polyline {
  fill: none;
  stroke: var(--dir, var(--flat));
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}

/* Piscar ao mudar o preço */
@keyframes flash-up { from { background: rgba(34, 197, 94, 0.4); } to { background: transparent; } }
@keyframes flash-down { from { background: rgba(239, 68, 68, 0.4); } to { background: transparent; } }
.flash-up { animation: flash-up 1s ease-out; }
.flash-down { animation: flash-down 1s ease-out; }

@media (prefers-reduced-motion: reduce) {
  .marquee { overflow-x: auto; }
  .marquee-track { animation: none; }
}
@media (max-width: 560px) {
  .cards { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Criar `public/app.js`**

```js
import {
  formatPrice, formatPct, formatChange, direction, ageText, sparkPoints,
} from './format.js';

const REFRESH_MS = 30_000;
const RETRY_MS = 2_000;
const STALE_MS = 120_000;
const MARQUEE_PX_PER_S = 60;
const SPARK_W = 120;
const SPARK_H = 32;
const SVG_NS = 'http://www.w3.org/2000/svg';

const $ = (id) => document.getElementById(id);
const lastPrice = new Map();
let built = false;
let marqueeFitted = false;
let lastDataAt = null; // relógio local (ms) do dado mais recente
let connectionLost = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildTick(q, sector) {
  const item = el('span', 'tick');
  item.dataset.symbol = q.symbol;
  item.style.setProperty('--accent', sector.color);
  item.append(
    el('span', 'badge', sector.label),
    el('span', 'sym', q.symbol),
    el('span', 'px', '—'),
    el('span', 'pct', ''),
  );
  return item;
}

function buildCard(q, sector) {
  const card = el('article', 'card');
  card.dataset.symbol = q.symbol;
  const head = el('div', 'card-head');
  head.append(el('span', 'name', q.name), el('span', 'sym', q.symbol));
  const row = el('div', 'row');
  row.append(el('span', 'pct', ''), el('span', 'chg', ''));
  const foot = el('div', 'foot');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', `0 0 ${SPARK_W} ${SPARK_H}`);
  svg.append(document.createElementNS(SVG_NS, 'polyline'));
  foot.append(el('span', 'state', ''), svg);
  card.append(head, el('div', 'price', '—'), row, foot);
  return card;
}

function build(sectors, quotes) {
  const sectorById = new Map(sectors.map((s) => [s.id, s]));
  const track = $('track');
  for (let copy = 0; copy < 2; copy += 1) {
    const group = el('div', 'marquee-group');
    if (copy === 1) group.setAttribute('aria-hidden', 'true');
    quotes.forEach((q) => group.append(buildTick(q, sectorById.get(q.sector))));
    track.append(group);
  }
  const grid = $('grid');
  sectors.forEach((sector) => {
    const section = el('section', 'sector');
    section.style.setProperty('--accent', sector.color);
    section.append(el('h2', '', sector.label));
    const cards = el('div', 'cards');
    quotes.filter((q) => q.sector === sector.id).forEach((q) => cards.append(buildCard(q, sector)));
    section.append(cards);
    grid.append(section);
  });
}

const setText = (root, selector, text) =>
  root.querySelectorAll(selector).forEach((n) => { n.textContent = text; });

function flash(root, cls) {
  root.querySelectorAll('.px, .price').forEach((n) => {
    n.classList.remove('flash-up', 'flash-down');
    void n.offsetWidth; // reinicia a animação
    n.classList.add(cls);
  });
}

function update(quotes) {
  quotes.forEach((q) => {
    document.querySelectorAll(`[data-symbol="${q.symbol}"]`).forEach((root) => {
      root.classList.toggle('stale', q.stale);
      if (!q.hasData) {
        root.dataset.dir = 'flat';
        setText(root, '.px, .price', '—');
        setText(root, '.pct', 'sem dados');
        setText(root, '.chg', '');
        setText(root, '.state', 'Sem dados');
        root.querySelector('polyline')?.setAttribute('points', '');
        return;
      }
      root.dataset.dir = direction(q.changePct);
      root.dataset.open = String(q.marketOpen);
      setText(root, '.px, .price', formatPrice(q.price, q.currency));
      setText(root, '.pct', formatPct(q.changePct));
      setText(root, '.chg', formatChange(q.change, q.currency));
      setText(root, '.state', q.marketOpen ? 'Aberto' : 'Fechado');
      root.querySelector('polyline')?.setAttribute('points', sparkPoints(q.series, SPARK_W, SPARK_H));

      const prev = lastPrice.get(q.symbol);
      if (prev !== undefined && prev !== q.price) {
        flash(root, q.price > prev ? 'flash-up' : 'flash-down');
      }
    });
    if (q.hasData) lastPrice.set(q.symbol, q.price);
  });
}

function fitMarquee() {
  const track = $('track');
  const seconds = track.scrollWidth / 2 / MARQUEE_PX_PER_S;
  track.style.setProperty('--dur', `${Math.max(seconds, 10)}s`);
}

function renderStatus() {
  const s = $('status');
  if (connectionLost) {
    s.textContent = 'Sem ligação ao servidor';
    s.dataset.level = 'error';
  } else if (lastDataAt === null) {
    s.textContent = 'À espera de dados…';
    s.dataset.level = 'warn';
  } else {
    const age = Date.now() - lastDataAt;
    s.textContent = `Atualizado ${ageText(Math.round(age / 1000))}`;
    s.dataset.level = age > STALE_MS ? 'warn' : 'ok';
  }
}

async function refresh() {
  let anyData = false;
  try {
    const res = await fetch('/api/quotes', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { serverTime, sectors, quotes } = await res.json();
    if (!built) {
      build(sectors, quotes);
      built = true;
    }
    update(quotes);
    anyData = quotes.some((q) => q.hasData);
    if (anyData && !marqueeFitted) {
      fitMarquee();
      marqueeFitted = true;
    }
    const newest = Math.max(0, ...quotes.map((q) => q.updatedAt ?? 0));
    lastDataAt = newest ? Date.now() - (serverTime - newest) : null;
    connectionLost = false;
  } catch {
    connectionLost = true;
  }
  renderStatus();
  // Arranque do servidor ainda sem dados: voltar a tentar depressa.
  setTimeout(refresh, anyData || connectionLost ? REFRESH_MS : RETRY_MS);
}

refresh();
setInterval(renderStatus, 1000);
```

- [ ] **Step 4: Verificação manual no browser**

Run: `node server.js` e abrir `http://localhost:3000`.
Confirmar:
1. Aparecem 12 cartões em 4 secções com a cor do setor, e a faixa no topo.
2. Os preços são reais (comparar 2-3 com o Yahoo Finance) e cada um na sua moeda (`$` e `₩`).
3. A faixa desliza em ciclo contínuo sem salto e pára com o rato por cima.
4. Verde com ▲ em subida e vermelho com ▼ em descida; mini-gráfico a condizer.
5. Ações fechadas (ex.: coreanas fora do horário) mostram "Fechado"; abertas mostram "Aberto".
6. Esperar 30 s ou mais: o "Atualizado há X s" volta a 0 e, se um preço mudar, pisca ~1 s.
7. Parar o servidor (Ctrl+C): em ≤30 s aparece "Sem ligação ao servidor" a vermelho; ao reiniciar, recupera sozinho.
8. Reduzir a janela para largura de telemóvel: cartões numa coluna, sem scroll horizontal.

Se algo falhar, corrigir antes de avançar.

- [ ] **Step 5: Correr os testes**

Run: `npm test`
Expected: PASS (todos; nada de lógica mudou)

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "feat: ticker marquee and sector cards UI" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verificação dos símbolos reais e README

**Files:**
- Create: `test/live.check.js`, `README.md`

**Interfaces:**
- Consumes (Tasks 1-2): `TICKERS`, `fetchChart`.
- Produces: `npm run check:live` (script manual, não faz parte de `npm test` porque depende da rede).

- [ ] **Step 1: Criar `test/live.check.js`**

```js
import { TICKERS } from '../src/tickers.js';
import { fetchChart } from '../src/yahoo.js';

const results = await Promise.allSettled(TICKERS.map((t) => fetchChart(t.symbol)));
let failures = 0;
results.forEach((r, i) => {
  const { symbol } = TICKERS[i];
  if (r.status === 'fulfilled') {
    const q = r.value;
    console.log(`OK    ${symbol.padEnd(10)} ${q.price} ${q.currency}  ${q.changePct.toFixed(2)}%  pontos=${q.series.length}`);
  } else {
    failures += 1;
    console.log(`FALHA ${symbol.padEnd(10)} ${r.reason.message}`);
  }
});
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Correr a verificação**

Run: `npm run check:live`
Expected: 12 linhas `OK` (incluindo `SPCX`, `000660.KS`, `005930.KS`) e código de saída 0. Se algum símbolo falhar, confirmar o ticker certo em finance.yahoo.com e corrigir `src/tickers.js`.

- [ ] **Step 3: Criar `README.md`**

````markdown
# Ticker de Ações

Página local com cotações quase em tempo real (Yahoo Finance, ~30 s, possível atraso conforme a bolsa) de ações farmacêuticas, nucleares, de memória e de tecnologia/espaço.

## Usar

```bash
npm start            # abre em http://localhost:3000 (PORT=4000 npm start para mudar)
npm test             # testes automáticos (sem rede)
npm run check:live   # confirma que os 12 símbolos respondem no Yahoo
```

Requer Node.js 22 ou superior. Não há dependências para instalar.

## Mudar as empresas

Edite `src/tickers.js` (símbolo, nome e setor) e reinicie o servidor.
````

- [ ] **Step 4: Verificação final**

Run: `npm test && npm run check:live`
Expected: todos os testes passam e 12 símbolos `OK`.

- [ ] **Step 5: Commit**

```bash
git add test/live.check.js README.md
git commit -m "chore: live symbol check and README" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
