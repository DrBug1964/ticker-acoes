# Ticker de Ações como aplicação distribuível — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o ticker numa aplicação Electron (Mac e Windows) onde cada utilizador escolhe, num formulário, as ações e o mercado que quer seguir, com fonte de dados Yahoo (sem chave) ou Finnhub (chave própria).

**Architecture:** Um `service` (definições + fonte de dados + armazém + ciclo de atualização) é exposto por um servidor HTTP local (`127.0.0.1`, porta livre) que o processo principal do Electron arranca e abre numa janela. As fontes de dados escondem-se atrás da mesma interface (`quote`, `search`, `markets`, `refreshMs`). A página é HTML/CSS/JS puro.

**Tech Stack:** Node.js 22 (ESM, `node:test`, `fetch`), Electron + electron-builder (só como `devDependencies`), sem outras dependências npm.

**Spec:** `docs/superpowers/specs/2026-10-02-electron-app-design.md` (substitui, quanto à lista de ações e à distribuição, `2026-10-01-ticker-acoes-design.md`).

**Desvios ao spec, decididos ao escrever o plano (a registar no spec no fim):**
1. **Finnhub e o limite de pedidos.** O plano gratuito permite 60 pedidos/minuto. Com 30 ações a 30 s seriam 60/min só em cotações. Por isso `refreshMs(n)` do Finnhub é `max(30 s, (n+1)/50 minutos)` (37,2 s para 30 ações). O Yahoo mantém 30 s.
2. **Finnhub: estado do mercado e série.** `marketOpen` vem de `/stock/market-status?exchange=US` (um pedido por ciclo, em cache 60 s). A série do dia vem sempre vazia (os mini-gráficos de candles do Finnhub não estão confirmados no plano gratuito; o cartão omite o gráfico, nunca o simula).
3. **Aviso de fonte.** `GET /api/quotes` e `GET /api/settings` devolvem `notice` (texto) quando todas as ações da fonte atual falham (por exemplo, "chave inválida ou sem permissão"). A página mostra-o numa faixa e nas Definições.
4. **Erro de arranque do servidor** mostra-se com uma caixa de diálogo do sistema (`dialog.showErrorBox`), não dentro da janela.

## Global Constraints

- Node.js 22. Sem dependências de runtime; só `electron` e `electron-builder` em `devDependencies`.
- Servidor só em `127.0.0.1`. Pedidos com `Host` diferente de `127.0.0.1:<porta>`/`localhost:<porta>`, ou com `Origin` diferente de `http://127.0.0.1:<porta>`/`http://localhost:<porta>`, recebem 403.
- Máximo de **30** ações por lista (validado no servidor e no formulário).
- A chave de API nunca é devolvida por nenhuma rota, nunca aparece em registos nem em mensagens de erro, e vai para o Finnhub no cabeçalho `X-Finnhub-Token` (nunca no URL).
- Atualização a cada 30 s (Yahoo); recuo ×2 até 5 min em HTTP 429.
- Texto da interface em português de Portugal. Números em fonte monoespaçada. Tema escuro. Verde/vermelho só para subida/descida.
- Mercados suportados (ids): `us`, `kr`, `uk`, `de`, `fr`, `nl`, `pt`, `jp`, `hk`. Finnhub: só `us`.
- Sem recolha de dados de utilização; a app só contacta a fonte de dados escolhida.
- Fora do âmbito: contas/sincronização, alertas, atualizações automáticas, assinatura dos instaladores, histórico de vários dias.

## Review Focus

1. **Ficheiro de definições corrompido ou com itens inválidos:** a app tem de arrancar na mesma (lista vazia ou só com os itens válidos), guardando uma cópia `.bak` do ficheiro estragado. Coberto na Task 1.
2. **Ação retirada da lista enquanto um ciclo de atualização está a decorrer:** o resultado atrasado dessa ação não pode rebentar (`undefined`) nem fazê-la reaparecer. Coberto nas Tasks 3 e 4.
3. **Mudar de fonte a meio de um ciclo:** resultados atrasados da fonte antiga não podem sobrepor-se aos da nova. Coberto na Task 4.
4. **A chave de API não pode vazar:** nem em `GET /api/settings`, nem em `/api/quotes`, nem nos erros do Finnhub. Coberto nas Tasks 2, 4 e 5.
5. **Pedidos de outras origens (página web no browser do utilizador a tentar escrever na lista) e caminhos fora de `public/`:** 403 e 404. Coberto na Task 5.

---

### Task 1: Mercados e definições do utilizador

**Files:**
- Create: `src/markets.js`, `src/settings.js`
- Test: `test/markets.test.js`, `test/settings.test.js`

**Interfaces:**
- Produces (`src/markets.js`): `MARKETS: {id,label,codes:string[],color}[]`, `marketById(id): Market|undefined`, `marketForExchange(code:string): string|null` (id do mercado ou `null` se a bolsa não for suportada).
- Produces (`src/settings.js`): `MAX_WATCHLIST = 30`, `PROVIDERS = ['yahoo','finnhub']`, `class ValidationError extends Error`, `validateWatchlist(items): WatchItem[]` (lança `ValidationError`; normaliza `symbol` para maiúsculas sem espaços, `name` com no máximo 80 caracteres, por defeito igual ao símbolo), `validateSettingsUpdate(update): {provider?, apiKey?}` (lança `ValidationError`), `loadSettings(file): Settings`, `saveSettings(file, settings): void`. `WatchItem = {symbol,name,market}`, `Settings = {version:1, provider, apiKey, watchlist}`.

- [ ] **Step 1: Escrever os testes que falham**

`test/markets.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETS, marketById, marketForExchange } from '../src/markets.js';

test('marketForExchange mapeia códigos de bolsa do Yahoo', () => {
  assert.equal(marketForExchange('NMS'), 'us');
  assert.equal(marketForExchange('NYQ'), 'us');
  assert.equal(marketForExchange('KSC'), 'kr');
  assert.equal(marketForExchange('LIS'), 'pt');
  assert.equal(marketForExchange('GER'), 'de');
  assert.equal(marketForExchange('FRA'), 'de');
});

test('marketForExchange devolve null para bolsas não suportadas', () => {
  assert.equal(marketForExchange('PNK'), null);
  assert.equal(marketForExchange('IOB'), null);
  assert.equal(marketForExchange(undefined), null);
});

test('ids e códigos de bolsa são únicos entre mercados', () => {
  const ids = MARKETS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  const codes = MARKETS.flatMap((m) => m.codes);
  assert.equal(new Set(codes).size, codes.length);
});

test('marketById', () => {
  assert.equal(marketById('us').label, 'EUA (NASDAQ e NYSE)');
  assert.equal(marketById('xx'), undefined);
});
```

`test/settings.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_WATCHLIST, ValidationError, validateWatchlist, validateSettingsUpdate,
  loadSettings, saveSettings,
} from '../src/settings.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ticker-'));
const tmp = () => join(dir(), 'settings.json');
const item = (symbol, market = 'us') => ({ symbol, name: symbol, market });
const defaults = { version: 1, provider: 'yahoo', apiKey: '', watchlist: [] };

test('ficheiro ausente dá definições por defeito', () => {
  assert.deepEqual(loadSettings(tmp()), defaults);
});

test('guardar e voltar a ler dá o mesmo', () => {
  const file = tmp();
  const s = { version: 1, provider: 'finnhub', apiKey: 'abc', watchlist: [item('NVDA')] };
  saveSettings(file, s);
  assert.deepEqual(loadSettings(file), s);
});

test('guardar cria a pasta e não deixa ficheiros temporários', () => {
  const base = dir();
  saveSettings(join(base, 'sub', 'settings.json'), defaults);
  assert.deepEqual(readdirSync(join(base, 'sub')), ['settings.json']);
});

test('ficheiro corrompido: arranca com defeitos e guarda cópia .bak', () => {
  const file = tmp();
  writeFileSync(file, '{isto não é json');
  assert.deepEqual(loadSettings(file), defaults);
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{isto não é json');
});

test('JSON que não é um objeto também conta como corrompido', () => {
  const file = tmp();
  writeFileSync(file, '[1,2,3]');
  assert.deepEqual(loadSettings(file), defaults);
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '[1,2,3]');
});

test('itens inválidos, repetidos e excedentes são descartados ao carregar', () => {
  const file = tmp();
  const many = Array.from({ length: 40 }, (_, i) => item(`S${i}`));
  writeFileSync(file, JSON.stringify({
    provider: 'bogus',
    apiKey: 42,
    watchlist: [item('OK1'), { symbol: '', market: 'us' }, item('BAD', 'zz'), item('OK1'), ...many],
  }));
  const s = loadSettings(file);
  assert.equal(s.provider, 'yahoo');
  assert.equal(s.apiKey, '');
  assert.equal(s.watchlist.length, MAX_WATCHLIST);
  assert.equal(s.watchlist[0].symbol, 'OK1');
  assert.equal(s.watchlist.filter((i) => i.symbol === 'OK1').length, 1);
});

test('validateWatchlist normaliza símbolo e nome', () => {
  const [a, b] = validateWatchlist([
    { symbol: ' nvda ', name: '  NVIDIA  ', market: 'us' },
    { symbol: '000660.KS', market: 'kr' },
  ]);
  assert.deepEqual(a, { symbol: 'NVDA', name: 'NVIDIA', market: 'us' });
  assert.deepEqual(b, { symbol: '000660.KS', name: '000660.KS', market: 'kr' });
});

test('validateWatchlist rejeita lista com mais de 30 itens', () => {
  const items = Array.from({ length: 31 }, (_, i) => item(`S${i}`));
  assert.throws(() => validateWatchlist(items), (e) => e instanceof ValidationError && /30/.test(e.message));
});

test('validateWatchlist rejeita símbolo vazio, repetido, com lixo ou mercado desconhecido', () => {
  assert.throws(() => validateWatchlist([item('')]), ValidationError);
  assert.throws(() => validateWatchlist([item('A B')]), ValidationError);
  assert.throws(() => validateWatchlist([item('<script>')]), ValidationError);
  assert.throws(() => validateWatchlist([item('A'), item('a')]), /repetido/);
  assert.throws(() => validateWatchlist([item('A', 'zz')]), /Mercado/);
  assert.throws(() => validateWatchlist('não é lista'), ValidationError);
  assert.throws(() => validateWatchlist([null]), ValidationError);
});

test('validateSettingsUpdate aceita fonte e chave, e rejeita o resto', () => {
  assert.deepEqual(validateSettingsUpdate({ provider: 'finnhub', apiKey: '  abc123 ' }), {
    provider: 'finnhub', apiKey: 'abc123',
  });
  assert.deepEqual(validateSettingsUpdate({ provider: 'yahoo' }), { provider: 'yahoo' });
  assert.throws(() => validateSettingsUpdate({ provider: 'bogus' }), ValidationError);
  assert.throws(() => validateSettingsUpdate({ apiKey: 'a b' }), ValidationError);
  assert.throws(() => validateSettingsUpdate({ apiKey: 'x'.repeat(201) }), ValidationError);
  assert.throws(() => validateSettingsUpdate(null), ValidationError);
});
```

- [ ] **Step 2: Correr os testes e confirmar que falham**

Run: `node --test test/markets.test.js test/settings.test.js`
Expected: FAIL (`Cannot find module '../src/markets.js'`)

- [ ] **Step 3: Implementar `src/markets.js`**

```js
export const MARKETS = [
  { id: 'us', label: 'EUA (NASDAQ e NYSE)', codes: ['NMS', 'NGM', 'NCM', 'NYQ', 'PCX', 'ASE'], color: '#4da3ff' },
  { id: 'kr', label: 'Coreia do Sul (Seul)', codes: ['KSC', 'KOE'], color: '#a78bfa' },
  { id: 'uk', label: 'Londres', codes: ['LSE'], color: '#f5c542' },
  { id: 'de', label: 'Alemanha (XETRA e Frankfurt)', codes: ['GER', 'FRA'], color: '#fb923c' },
  { id: 'fr', label: 'Paris', codes: ['PAR'], color: '#34d399' },
  { id: 'nl', label: 'Amesterdão', codes: ['AMS'], color: '#f472b6' },
  { id: 'pt', label: 'Lisboa', codes: ['LIS'], color: '#22d3ee' },
  { id: 'jp', label: 'Tóquio', codes: ['JPX'], color: '#f87171' },
  { id: 'hk', label: 'Hong Kong', codes: ['HKG'], color: '#a3e635' },
];

export const marketById = (id) => MARKETS.find((m) => m.id === id);

export const marketForExchange = (code) =>
  MARKETS.find((m) => m.codes.includes(code))?.id ?? null;
```

- [ ] **Step 4: Implementar `src/settings.js`**

```js
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { marketById } from './markets.js';

export const MAX_WATCHLIST = 30;
export const PROVIDERS = ['yahoo', 'finnhub'];

export class ValidationError extends Error {}

const defaults = () => ({ version: 1, provider: 'yahoo', apiKey: '', watchlist: [] });

export function validateWatchlist(items) {
  if (!Array.isArray(items)) throw new ValidationError('A lista tem de ser um array');
  if (items.length > MAX_WATCHLIST) {
    throw new ValidationError(`No máximo ${MAX_WATCHLIST} ações por lista`);
  }
  const seen = new Set();
  return items.map((it) => {
    const symbol = typeof it?.symbol === 'string' ? it.symbol.trim().toUpperCase() : '';
    if (!symbol || symbol.length > 20 || !/^[A-Z0-9.^=-]+$/.test(symbol)) {
      throw new ValidationError('Símbolo inválido');
    }
    if (!marketById(it.market)) throw new ValidationError(`Mercado desconhecido: ${it.market}`);
    if (seen.has(symbol)) throw new ValidationError(`Símbolo repetido: ${symbol}`);
    seen.add(symbol);
    const name = typeof it.name === 'string' ? it.name.trim().slice(0, 80) : '';
    return { symbol, name: name || symbol, market: it.market };
  });
}

export function validateSettingsUpdate(update) {
  if (typeof update !== 'object' || update === null || Array.isArray(update)) {
    throw new ValidationError('Pedido inválido');
  }
  const out = {};
  if ('provider' in update) {
    if (!PROVIDERS.includes(update.provider)) throw new ValidationError('Fonte de dados desconhecida');
    out.provider = update.provider;
  }
  if ('apiKey' in update) {
    const key = typeof update.apiKey === 'string' ? update.apiKey.trim() : null;
    if (key === null || key.length > 200 || /\s/.test(key)) throw new ValidationError('Chave inválida');
    out.apiKey = key;
  }
  return out;
}

function normalize(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('formato');
  const watchlist = [];
  for (const it of Array.isArray(data.watchlist) ? data.watchlist : []) {
    if (watchlist.length >= MAX_WATCHLIST) break;
    try {
      const [ok] = validateWatchlist([it]);
      if (!watchlist.some((w) => w.symbol === ok.symbol)) watchlist.push(ok);
    } catch {
      // item inválido: descartado
    }
  }
  return {
    version: 1,
    provider: PROVIDERS.includes(data.provider) ? data.provider : 'yahoo',
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
    watchlist,
  };
}

export function loadSettings(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return defaults();
  }
  try {
    return normalize(JSON.parse(raw));
  } catch {
    try {
      copyFileSync(file, `${file}.bak`);
    } catch {
      // sem cópia: continua com os valores por defeito
    }
    return defaults();
  }
}

export function saveSettings(file, settings) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2));
  renameSync(tmp, file);
}
```

- [ ] **Step 5: Correr os testes e confirmar que passam**

Run: `npm test`
Expected: PASS (todos, incluindo os 30 anteriores)

- [ ] **Step 6: Commit**

```bash
git add src/markets.js src/settings.js test/markets.test.js test/settings.test.js
git commit -m "feat: markets table and user settings with validation" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Fontes de dados (Yahoo e Finnhub)

**Files:**
- Create: `src/providers/yahoo.js`, `src/providers/finnhub.js`, `src/providers/index.js`
- Modify: `test/live.check.js` (deixa de importar `src/tickers.js`)
- Test: `test/providers.test.js`

**Interfaces:**
- Consumes (Task 1): `MARKETS`, `marketById`, `marketForExchange`.
- Consumes (existente): `fetchChart(symbol, fetchImpl)` e o tipo `Quote` de `src/yahoo.js`.
- Produces: `Provider = { id:'yahoo'|'finnhub', markets: Market[], refreshMs(n:number):number, quote(symbol):Promise<Quote>, search(query, marketId?):Promise<{symbol,name,market}[]> }`.
- Produces (`src/providers/yahoo.js`): `parseSearch(json, marketId='all')`, `createYahooProvider({fetchImpl?})`.
- Produces (`src/providers/finnhub.js`): `parseQuote(json, isOpen)`, `isUsListing(symbol)`, `createFinnhubProvider({apiKey, fetchImpl?, now?})`.
- Produces (`src/providers/index.js`): `createProvider(id, {apiKey?, fetchImpl?})`, `PROVIDER_INFO: {id,label}[]`.
- Erros: HTTP 429 → `Error` com `rateLimited = true`; Finnhub 401/403 → `Error('chave inválida ou sem permissão')`; Finnhub sem chave → `Error('Falta a chave do Finnhub')`.

- [ ] **Step 1: Escrever os testes que falham**

`test/providers.test.js`:
```js
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
```

- [ ] **Step 2: Correr o teste e confirmar que falha**

Run: `node --test test/providers.test.js`
Expected: FAIL (`Cannot find module '../src/providers/yahoo.js'`)

- [ ] **Step 3: Implementar `src/providers/yahoo.js`**

```js
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
```

- [ ] **Step 4: Implementar `src/providers/finnhub.js`**

```js
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
```

- [ ] **Step 5: Implementar `src/providers/index.js`**

```js
import { createYahooProvider } from './yahoo.js';
import { createFinnhubProvider } from './finnhub.js';

export const PROVIDER_INFO = [
  { id: 'yahoo', label: 'Yahoo Finance (sem chave, todos os mercados)' },
  { id: 'finnhub', label: 'Finnhub (chave própria, só ações dos EUA)' },
];

export function createProvider(id, { apiKey = '', fetchImpl = fetch } = {}) {
  if (id === 'finnhub') return createFinnhubProvider({ apiKey, fetchImpl });
  return createYahooProvider({ fetchImpl });
}
```

- [ ] **Step 6: Reescrever `test/live.check.js` (já sem `src/tickers.js`)**

```js
import { createProvider } from '../src/providers/index.js';

const provider = createProvider('yahoo');
const probes = [
  ['micron', 'us'],
  ['samsung', 'kr'],
  ['galp', 'pt'],
  ['toyota', 'jp'],
  ['siemens', 'de'],
  ['bp', 'uk'],
];

let failures = 0;
for (const [query, market] of probes) {
  try {
    const results = await provider.search(query, market);
    if (!results.length) throw new Error('pesquisa sem resultados');
    const first = results[0];
    const q = await provider.quote(first.symbol);
    console.log(`OK    ${market.padEnd(3)} ${query.padEnd(8)} -> ${first.symbol.padEnd(10)} ${q.price} ${q.currency} pontos=${q.series.length}`);
  } catch (err) {
    failures += 1;
    console.log(`FALHA ${market.padEnd(3)} ${query.padEnd(8)} ${err.message}`);
  }
}
process.exit(failures ? 1 : 0);
```

- [ ] **Step 7: Correr os testes e confirmar que passam; correr a verificação com rede**

Run: `npm test`
Expected: PASS (todos)

Run: `npm run check:live`
Expected: 6 linhas `OK` (uma por mercado sondado) e código de saída 0.

- [ ] **Step 8: Commit**

```bash
git add src/providers test/providers.test.js test/live.check.js
git commit -m "feat: pluggable data providers (Yahoo, Finnhub) with search" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Armazém reconstruível e estados da página

**Files:**
- Modify: `src/store.js`, `public/format.js`
- Modify: `test/store.test.js`, `test/format.test.js`

**Interfaces:**
- Consumes: `QuoteStore` atual (`constructor(tickers, now?)`, `applyResult`, `applyError`, `snapshot`).
- Produces: `QuoteStore#setTickers(tickers)` (mantém valores dos símbolos que ficam, descarta os removidos, cria os novos sem dados). Os tickers passam a ter `{symbol, name, market}` e `snapshot()` devolve `market` em vez de `sector`. `applyResult`/`applyError` **ignoram símbolos desconhecidos** (não lançam).
- Produces (`public/format.js`): `UNSUPPORTED = 'sem dados nesta fonte'` e `stateText` passa a devolver `'Sem dados nesta fonte'` quando `!hasData && error === UNSUPPORTED`.

- [ ] **Step 1: Escrever os testes que falham**

Em `test/store.test.js`, trocar os campos `sector` pelos novos `market` (`sector: 'pharma'` → `market: 'us'`, `sector: 'nuclear'` → `market: 'kr'`) com:
```bash
sed -i.bak "s/sector: 'pharma'/market: 'us'/; s/sector: 'nuclear'/market: 'kr'/" test/store.test.js && rm test/store.test.js.bak
```
e acrescentar no fim do ficheiro:
```js
test('o snapshot traz o mercado da ação', () => {
  const store = new QuoteStore(tickers);
  assert.equal(bySymbol(store, 'A').market, 'us');
  assert.equal(bySymbol(store, 'B').market, 'kr');
});

test('applyResult e applyError ignoram símbolos desconhecidos (ação já retirada)', () => {
  const store = new QuoteStore(tickers);
  assert.doesNotThrow(() => store.applyResult('REMOVIDA', quote(110)));
  assert.doesNotThrow(() => store.applyError('REMOVIDA', new Error('x')));
  assert.equal(store.snapshot().length, 2);
});

test('setTickers mantém valores, descarta removidos e cria novos sem dados', () => {
  const store = new QuoteStore(tickers);
  store.applyResult('A', quote(110));
  store.applyResult('B', quote(120));
  store.setTickers([
    { symbol: 'A', name: 'Alpha 2', market: 'us' },
    { symbol: 'C', name: 'Gamma', market: 'kr' },
  ]);
  assert.deepEqual(store.snapshot().map((e) => e.symbol), ['A', 'C']);
  assert.equal(bySymbol(store, 'A').price, 110);
  assert.equal(bySymbol(store, 'A').name, 'Alpha 2');
  assert.equal(bySymbol(store, 'C').hasData, false);
});

test('um símbolo retirado e voltado a adicionar começa sem dados', () => {
  const store = new QuoteStore(tickers);
  store.applyResult('A', quote(110));
  store.setTickers([tickers[1]]);
  store.setTickers(tickers);
  assert.equal(bySymbol(store, 'A').hasData, false);
});
```
Em `test/format.test.js`, acrescentar `UNSUPPORTED` ao import e no fim:
```js
test('stateText: sem dados nesta fonte', () => {
  assert.equal(
    stateText({ hasData: false, stale: false, error: UNSUPPORTED }, 0),
    'Sem dados nesta fonte',
  );
  assert.equal(stateText({ hasData: false, stale: false, error: 'HTTP 500' }, 0), 'Sem dados');
});
```
(o import passa a ser `... sparkPoints, stateText, UNSUPPORTED,`).

- [ ] **Step 2: Correr os testes e confirmar que falham**

Run: `npm test`
Expected: FAIL (`setTickers is not a function`; `UNSUPPORTED` não exportado)

- [ ] **Step 3: Alterar `src/store.js`**

Substituir o construtor e os métodos `applyResult`, `applyError`, `snapshot` por:
```js
export class QuoteStore {
  constructor(tickers, now = () => Date.now()) {
    this.now = now;
    this.entries = new Map();
    this.setTickers(tickers);
  }

  setTickers(tickers) {
    const next = new Map();
    for (const t of tickers) {
      const prev = this.entries.get(t.symbol);
      next.set(
        t.symbol,
        prev ? { ...prev, ...t } : { ...t, data: null, updatedAt: null, error: null },
      );
    }
    this.entries = next;
  }

  applyResult(symbol, quote) {
    const e = this.entries.get(symbol);
    if (!e) return;
    e.data = quote;
    e.updatedAt = this.now();
    e.error = null;
  }

  applyError(symbol, err) {
    const e = this.entries.get(symbol);
    if (e) e.error = err.message;
  }

  snapshot() {
    return [...this.entries.values()].map((e) => ({
      symbol: e.symbol,
      name: e.name,
      market: e.market,
      hasData: e.data !== null,
      stale: e.data !== null && e.error !== null,
      error: e.error,
      updatedAt: e.updatedAt,
      ...(e.data ?? {}),
    }));
  }
}
```
(`refreshAll` e `nextDelay` ficam como estão.)

- [ ] **Step 4: Alterar `public/format.js`**

Acrescentar antes de `stateText` e substituir a primeira linha da função:
```js
export const UNSUPPORTED = 'sem dados nesta fonte';

export function stateText(q, now) {
  if (!q.hasData) return q.error === UNSUPPORTED ? 'Sem dados nesta fonte' : 'Sem dados';
  if (q.stale) return `Desatualizado ${ageText((now - q.updatedAt) / 1000)}`;
  return q.marketOpen ? 'Aberto' : 'Fechado';
}
```
(apagar a versão antiga de `stateText`).

- [ ] **Step 5: Correr os testes e confirmar que passam**

Run: `npm test`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add src/store.js public/format.js test/store.test.js test/format.test.js
git commit -m "feat: rebuildable quote store, tolerate removed symbols, unsupported state" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Serviço (definições + fonte + armazém + ciclo)

**Files:**
- Create: `src/service.js`, `test/helpers.js`
- Test: `test/service.test.js`

**Interfaces:**
- Consumes: `loadSettings/saveSettings/validateWatchlist/validateSettingsUpdate/ValidationError` (T1), `createProvider/PROVIDER_INFO` (T2), `QuoteStore/refreshAll/nextDelay` (T3), `marketById` (T1).
- Produces: `UNSUPPORTED` (mesma cadeia que `public/format.js`) e `createService({settingsFile, fetchImpl?, now?, makeProvider?}): Service` com:
  - `getWatchlist(): WatchItem[]`, `setWatchlist(items): WatchItem[]` (valida, guarda, reconstrói o armazém, antecipa um ciclo)
  - `getSettings(): { provider, hasKey, providers, markets:[{id,label,color}], notice }`, `updateSettings(update): getSettings()` (valida, guarda, troca de fonte se preciso)
  - `search(query, marketId?): Promise<{symbol,name,market,marketLabel}[]>` (lança `ValidationError` se `query` < 2 caracteres ou mercado desconhecido; erros da fonte propagam-se)
  - `quotesPayload(): { serverTime, groups:[{market,label,color,quotes:Entry[]}], notice, provider, hasKey }`
  - `refresh(): Promise<{rateLimited:boolean, notice:string|null}>` (um ciclo; usado pelo ciclo e pelos testes), `start()`, `stop()`
- Produces (`test/helpers.js`): `fakeProvider(overrides?)`, `tmpSettingsFile()`, `deferred()`.

- [ ] **Step 1: Criar `test/helpers.js`**

```js
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { marketById } from '../src/markets.js';

export const tmpSettingsFile = () =>
  join(mkdtempSync(join(tmpdir(), 'ticker-')), 'settings.json');

export const quoteOf = (price = 110) => ({
  price, previousClose: 100, change: price - 100, changePct: price - 100,
  currency: 'USD', marketOpen: true, series: [100, price],
});

export const fakeProvider = (over = {}) => ({
  id: 'fake',
  markets: [marketById('us'), marketById('kr')],
  refreshMs: () => 30_000,
  quote: async () => quoteOf(110),
  search: async () => [{ symbol: 'MU', name: 'Micron', market: 'us' }],
  ...over,
});

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
```

- [ ] **Step 2: Escrever os testes que falham**

`test/service.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createService, UNSUPPORTED } from '../src/service.js';
import { UNSUPPORTED as UI_UNSUPPORTED } from '../public/format.js';
import { ValidationError, loadSettings, saveSettings } from '../src/settings.js';
import { marketById } from '../src/markets.js';
import { fakeProvider, tmpSettingsFile, quoteOf, deferred } from './helpers.js';

const item = (symbol, market = 'us') => ({ symbol, name: symbol, market });

function make(over = {}, settings = {}) {
  const file = tmpSettingsFile();
  saveSettings(file, {
    version: 1, provider: 'yahoo', apiKey: '', watchlist: [], ...settings,
  });
  const provider = fakeProvider(over);
  const service = createService({ settingsFile: file, makeProvider: () => provider });
  return { service, file, provider };
}

test('UNSUPPORTED é a mesma cadeia no servidor e na página', () => {
  assert.equal(UNSUPPORTED, UI_UNSUPPORTED);
});

test('refresh preenche as cotações e agrupa por mercado, na ordem de aparição', async () => {
  const { service } = make({}, { watchlist: [item('A'), item('B', 'kr'), item('C')] });
  await service.refresh();
  const p = service.quotesPayload();
  assert.deepEqual(p.groups.map((g) => g.market), ['us', 'kr']);
  assert.deepEqual(p.groups[0].quotes.map((q) => q.symbol), ['A', 'C']);
  assert.equal(p.groups[0].label, marketById('us').label);
  assert.equal(p.groups[0].color, marketById('us').color);
  assert.equal(p.groups[0].quotes[0].price, 110);
  assert.equal(typeof p.serverTime, 'number');
  assert.equal(p.notice, null);
});

test('ação de mercado que a fonte não suporta fica marcada e não é pedida', async () => {
  const asked = [];
  const { service } = make(
    { markets: [marketById('us')], quote: async (s) => { asked.push(s); return quoteOf(); } },
    { watchlist: [item('A'), item('B', 'kr')] },
  );
  await service.refresh();
  assert.deepEqual(asked, ['A']);
  const b = service.quotesPayload().groups.flatMap((g) => g.quotes).find((q) => q.symbol === 'B');
  assert.equal(b.hasData, false);
  assert.equal(b.error, UNSUPPORTED);
});

test('setWatchlist valida, guarda em disco e atualiza a lista', async () => {
  const { service, file } = make();
  const saved = service.setWatchlist([{ symbol: ' mu ', name: 'Micron', market: 'us' }]);
  assert.deepEqual(saved, [{ symbol: 'MU', name: 'Micron', market: 'us' }]);
  assert.deepEqual(loadSettings(file).watchlist, saved);
  assert.deepEqual(service.getWatchlist(), saved);
  assert.equal(service.quotesPayload().groups[0].quotes[0].symbol, 'MU');
});

test('setWatchlist inválida lança e não altera nada', () => {
  const { service, file } = make({}, { watchlist: [item('A')] });
  const many = Array.from({ length: 31 }, (_, i) => item(`S${i}`));
  assert.throws(() => service.setWatchlist(many), ValidationError);
  assert.throws(() => service.setWatchlist([item('A', 'zz')]), ValidationError);
  assert.deepEqual(service.getWatchlist().map((i) => i.symbol), ['A']);
  assert.deepEqual(loadSettings(file).watchlist.map((i) => i.symbol), ['A']);
});

test('retirar uma ação a meio de um ciclo não rebenta nem a faz reaparecer', async () => {
  const gate = deferred();
  const { service } = make({ quote: () => gate.promise }, { watchlist: [item('A')] });
  const cycle = service.refresh();
  service.setWatchlist([]);
  gate.resolve(quoteOf(999));
  await assert.doesNotReject(cycle);
  assert.deepEqual(service.quotesPayload().groups, []);
});

test('mudar de fonte a meio de um ciclo descarta os resultados da fonte antiga', async () => {
  const gate = deferred();
  const file = tmpSettingsFile();
  saveSettings(file, { version: 1, provider: 'yahoo', apiKey: '', watchlist: [item('A')] });
  const providers = {
    yahoo: fakeProvider({ quote: () => gate.promise }),
    finnhub: fakeProvider({ id: 'finnhub', quote: async () => quoteOf(111) }),
  };
  const service = createService({ settingsFile: file, makeProvider: (id) => providers[id] });
  const cycle = service.refresh();
  service.updateSettings({ provider: 'finnhub' });
  gate.resolve(quoteOf(999));
  await cycle;
  assert.equal(service.quotesPayload().groups[0].quotes[0].hasData, false);
  await service.refresh();
  assert.equal(service.quotesPayload().groups[0].quotes[0].price, 111);
});

test('updateSettings guarda fonte e chave; a chave nunca é devolvida', () => {
  const { service, file } = make();
  const out = service.updateSettings({ provider: 'finnhub', apiKey: 'SEGREDO123' });
  assert.equal(out.provider, 'finnhub');
  assert.equal(out.hasKey, true);
  assert.ok(Array.isArray(out.providers) && out.providers.length === 2);
  assert.ok(out.markets.every((m) => 'id' in m && 'label' in m && !('codes' in m)));
  assert.doesNotMatch(JSON.stringify(service.getSettings()), /SEGREDO123/);
  assert.doesNotMatch(JSON.stringify(service.quotesPayload()), /SEGREDO123/);
  assert.equal(loadSettings(file).apiKey, 'SEGREDO123');
  assert.throws(() => service.updateSettings({ provider: 'bogus' }), ValidationError);
});

test('quando todas as ações falham, o aviso traz o motivo; se só algumas falham, não', async () => {
  const bad = make(
    { quote: async () => { throw new Error('chave inválida ou sem permissão'); } },
    { watchlist: [item('A'), item('B')] },
  );
  await bad.service.refresh();
  assert.equal(bad.service.quotesPayload().notice, 'chave inválida ou sem permissão');
  assert.equal(bad.service.getSettings().notice, 'chave inválida ou sem permissão');

  const partial = make(
    { quote: async (s) => { if (s === 'B') throw new Error('HTTP 404'); return quoteOf(); } },
    { watchlist: [item('A'), item('B')] },
  );
  await partial.service.refresh();
  assert.equal(partial.service.quotesPayload().notice, null);
});

test('search valida o pedido e acrescenta o nome do mercado', async () => {
  const { service } = make();
  await assert.rejects(service.search('a'), ValidationError);
  await assert.rejects(service.search('  '), ValidationError);
  await assert.rejects(service.search('micron', 'zz'), ValidationError);
  const out = await service.search(' micron ', 'all');
  assert.deepEqual(out, [{ symbol: 'MU', name: 'Micron', market: 'us', marketLabel: marketById('us').label }]);
});

test('search aceita só mercados da fonte atual; erros da fonte propagam-se', async () => {
  const { service } = make({ markets: [marketById('us')] });
  await assert.rejects(service.search('samsung', 'kr'), ValidationError);
  const failing = make({ search: async () => { throw new Error('HTTP 500'); } });
  await assert.rejects(failing.service.search('micron'), /HTTP 500/);
});

test('start faz um primeiro ciclo sozinho e stop pára o ciclo', async () => {
  const { service } = make({}, { watchlist: [item('A')] });
  service.start();
  await new Promise((r) => setTimeout(r, 40));
  service.stop();
  assert.equal(service.quotesPayload().groups[0].quotes[0].price, 110);
});

test('definições corrompidas no disco: o serviço arranca com a lista vazia', () => {
  const file = tmpSettingsFile();
  writeFileSync(file, '{lixo');
  const service = createService({ settingsFile: file, makeProvider: () => fakeProvider() });
  assert.deepEqual(service.getWatchlist(), []);
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{lixo');
});
```

- [ ] **Step 3: Correr o teste e confirmar que falha**

Run: `node --test test/service.test.js`
Expected: FAIL (`Cannot find module '../src/service.js'`)

- [ ] **Step 4: Implementar `src/service.js`**

```js
import {
  loadSettings, saveSettings, validateWatchlist, validateSettingsUpdate, ValidationError,
} from './settings.js';
import { QuoteStore, refreshAll, nextDelay } from './store.js';
import { createProvider, PROVIDER_INFO } from './providers/index.js';
import { marketById } from './markets.js';

export const UNSUPPORTED = 'sem dados nesta fonte';

const publicMarkets = (provider) =>
  provider.markets.map(({ id, label, color }) => ({ id, label, color }));

export function createService({
  settingsFile,
  fetchImpl = fetch,
  now = () => Date.now(),
  makeProvider = createProvider,
}) {
  let settings = loadSettings(settingsFile);
  let provider = makeProvider(settings.provider, { apiKey: settings.apiKey, fetchImpl });
  const store = new QuoteStore(settings.watchlist, now);
  let notice = null;
  let delay = provider.refreshMs(settings.watchlist.length);
  let running = false;
  let inFlight = false;
  let again = false;
  let timer = null;

  function persist(next) {
    settings = next;
    saveSettings(settingsFile, settings);
  }

  async function refresh() {
    const current = provider;
    const items = settings.watchlist;
    const supported = new Set(current.markets.map((m) => m.id));
    const usable = items.filter((i) => supported.has(i.market));
    for (const i of items) {
      if (!supported.has(i.market)) store.applyError(i.symbol, new Error(UNSUPPORTED));
    }
    // só a fonte ainda ativa pode escrever no armazém
    const guarded = {
      applyResult: (s, q) => { if (current === provider) store.applyResult(s, q); },
      applyError: (s, e) => { if (current === provider) store.applyError(s, e); },
    };
    const { rateLimited, failed } = await refreshAll(usable, (s) => current.quote(s), guarded);
    if (current !== provider) return { rateLimited: false, notice };
    notice = usable.length > 0 && failed.length === usable.length
      ? store.entries.get(failed[0])?.error ?? null
      : null;
    return { rateLimited, notice };
  }

  async function tick() {
    if (!running) return;
    if (inFlight) { again = true; return; }
    inFlight = true;
    clearTimeout(timer);
    try {
      const out = await refresh();
      delay = nextDelay(delay, out.rateLimited, provider.refreshMs(settings.watchlist.length));
    } catch (err) {
      console.warn(`falha no ciclo de atualização: ${err.message}`);
    } finally {
      inFlight = false;
      if (running) timer = setTimeout(tick, again ? 0 : delay);
      again = false;
    }
  }

  const getSettings = () => ({
    provider: settings.provider,
    hasKey: Boolean(settings.apiKey),
    providers: PROVIDER_INFO,
    markets: publicMarkets(provider),
    notice,
  });

  return {
    refresh,
    start() { running = true; tick(); },
    stop() { running = false; clearTimeout(timer); },

    getWatchlist: () => settings.watchlist.map((i) => ({ ...i })),

    setWatchlist(items) {
      const valid = validateWatchlist(items);
      persist({ ...settings, watchlist: valid });
      store.setTickers(valid);
      tick();
      return valid.map((i) => ({ ...i }));
    },

    getSettings,

    updateSettings(update) {
      const changes = validateSettingsUpdate(update);
      persist({ ...settings, ...changes });
      provider = makeProvider(settings.provider, { apiKey: settings.apiKey, fetchImpl });
      delay = provider.refreshMs(settings.watchlist.length);
      notice = null;
      tick();
      return getSettings();
    },

    async search(query, marketId = 'all') {
      const q = String(query ?? '').trim();
      if (q.length < 2) throw new ValidationError('Escreva pelo menos 2 caracteres');
      if (marketId !== 'all' && !provider.markets.some((m) => m.id === marketId)) {
        throw new ValidationError('Mercado desconhecido');
      }
      const results = await provider.search(q, marketId);
      return results.map((r) => ({ ...r, marketLabel: marketById(r.market)?.label ?? r.market }));
    },

    quotesPayload() {
      const groups = [];
      const byMarket = new Map();
      for (const q of store.snapshot()) {
        let g = byMarket.get(q.market);
        if (!g) {
          const m = marketById(q.market);
          g = { market: m.id, label: m.label, color: m.color, quotes: [] };
          byMarket.set(q.market, g);
          groups.push(g);
        }
        g.quotes.push(q);
      }
      return {
        serverTime: now(),
        groups,
        notice,
        provider: settings.provider,
        hasKey: Boolean(settings.apiKey),
      };
    },
  };
}
```

- [ ] **Step 5: Correr os testes e confirmar que passam**

Run: `npm test`
Expected: PASS (todos). Se o teste "mudar de fonte a meio de um ciclo" falhar, é porque resultados antigos estão a chegar ao armazém: rever o `guarded` em `refresh`.

- [ ] **Step 6: Commit**

```bash
git add src/service.js test/helpers.js test/service.test.js
git commit -m "feat: service tying settings, provider, store and refresh loop" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Servidor HTTP (rotas, validação, origem local)

**Files:**
- Replace: `src/app.js`, `server.js`, `test/app.test.js`
- Delete: `src/tickers.js`
- Modify: `.gitignore` (acrescentar `dev-settings.json` e `dist/`)

**Interfaces:**
- Consumes (T4): `Service` (`quotesPayload`, `search`, `getWatchlist`, `setWatchlist`, `getSettings`, `updateSettings`, `start`).
- Consumes (T1): `ValidationError`.
- Produces: `createApp(service): http.Server`. Rotas: `GET /api/quotes`, `GET /api/search?q&market`, `GET|PUT /api/watchlist` (corpo `{items}`), `GET|PUT /api/settings`; estáticos `.html/.css/.js` de `public/`. Erros: 400 `{error}` para `ValidationError` ou JSON inválido/grande; 429 `{error}` se a fonte limitar; 502 `{error}` se a pesquisa falhar; 403 `{error}` para `Host`/`Origin` não locais; 404.

- [ ] **Step 1: Reescrever `test/app.test.js`**

```js
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
```

- [ ] **Step 2: Correr o teste e confirmar que falha**

Run: `node --test test/app.test.js`
Expected: FAIL (o `createApp` atual não aceita um serviço: erro `store.snapshot is not a function` / rotas em falta)

- [ ] **Step 3: Reescrever `src/app.js`**

```js
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationError } from './settings.js';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
const MAX_BODY = 64 * 1024;

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...extra });
  res.end(body);
}
const sendJson = (res, status, obj) =>
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj), { 'Cache-Control': 'no-store' });

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ValidationError('Pedido demasiado grande');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('JSON inválido');
  }
}

export function createApp(service) {
  const server = http.createServer(async (req, res) => {
    const port = server.address()?.port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const origin = req.headers.origin;
    if (!hosts.includes(req.headers.host) || (origin !== undefined && !hosts.some((h) => origin === `http://${h}`))) {
      return sendJson(res, 403, { error: 'Acesso recusado' });
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return sendJson(res, 400, { error: 'Pedido inválido' });
    }

    if (pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, res, pathname);
      } catch (err) {
        if (err instanceof ValidationError) return sendJson(res, 400, { error: err.message });
        console.warn(`erro interno em ${pathname}: ${err.message}`);
        return sendJson(res, 500, { error: 'Erro interno' });
      }
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

  async function handleApi(req, res, pathname) {
    const { method } = req;
    const url = new URL(req.url, 'http://localhost');

    if (pathname === '/api/quotes' && method === 'GET') {
      return sendJson(res, 200, service.quotesPayload());
    }

    if (pathname === '/api/search' && method === 'GET') {
      try {
        const results = await service.search(
          url.searchParams.get('q') ?? '',
          url.searchParams.get('market') ?? 'all',
        );
        return sendJson(res, 200, { results });
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        if (err.rateLimited) {
          return sendJson(res, 429, { error: 'Limite de pedidos da fonte de dados. Tente daqui a pouco.' });
        }
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (pathname === '/api/watchlist') {
      if (method === 'GET') return sendJson(res, 200, { items: service.getWatchlist() });
      if (method === 'PUT') {
        const body = await readJson(req);
        if (!body || !('items' in body)) throw new ValidationError('Falta o campo "items"');
        return sendJson(res, 200, { items: service.setWatchlist(body.items) });
      }
    }

    if (pathname === '/api/settings') {
      if (method === 'GET') return sendJson(res, 200, service.getSettings());
      if (method === 'PUT') return sendJson(res, 200, service.updateSettings(await readJson(req)));
    }

    return sendJson(res, 404, { error: 'Não encontrado' });
  }

  return server;
}
```

- [ ] **Step 4: Reescrever `server.js` (arranque de desenvolvimento, sem Electron)**

```js
import { createService } from './src/service.js';
import { createApp } from './src/app.js';

const PORT = Number(process.env.PORT) || 3000;
const service = createService({
  settingsFile: process.env.TICKER_SETTINGS || './dev-settings.json',
});

createApp(service).listen(PORT, '127.0.0.1', () => {
  console.log(`Ticker em http://127.0.0.1:${PORT}`);
  service.start();
});
```

- [ ] **Step 5: Apagar `src/tickers.js` e atualizar `.gitignore`**

```bash
git rm -q src/tickers.js
printf 'dev-settings.json\ndist/\n' >> .gitignore
```

- [ ] **Step 6: Correr os testes e confirmar que passam**

Run: `npm test`
Expected: PASS (todos). Nota: o teste "falha da fonte dá 502 e limite dá 429" depende de o serviço chamar `makeProvider` ao `updateSettings`; é por isso que a variável `provider` do teste é reatribuída antes de cada troca.

- [ ] **Step 7: Verificar o servidor a sério**

Run (terminal 1): `PORT=3123 TICKER_SETTINGS=/tmp/ticker-dev.json node server.js`
Em outro:
```bash
curl -s -X PUT localhost:3123/api/watchlist -H 'Content-Type: application/json' \
  -d '{"items":[{"symbol":"MU","name":"Micron","market":"us"},{"symbol":"005930.KS","name":"Samsung","market":"kr"}]}'
sleep 3
curl -s localhost:3123/api/quotes | head -c 700
curl -s 'localhost:3123/api/search?q=galp&market=pt'
```
Expected: o `PUT` devolve os 2 itens; `/api/quotes` mostra 2 grupos (`us`, `kr`) com `hasData: true` e preços reais; a pesquisa devolve `GALP.LS`. Parar o servidor com Ctrl+C e apagar `/tmp/ticker-dev.json`.

- [ ] **Step 8: Commit**

```bash
git add -A src server.js test/app.test.js .gitignore
git commit -m "feat: local HTTP API for watchlist, search and settings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Interface (formulário, definições, grupos por mercado)

**Files:**
- Create: `public/api.js`, `public/latest.js`, `public/view.js`, `public/panels.js`
- Replace: `public/index.html`, `public/app.js`
- Modify: `public/style.css` (acrescentar estilos)
- Test: `test/latest.test.js`, `test/ui-contract.test.js`

**Interfaces:**
- Consumes (T5): as rotas `/api/*`; (T3) `stateText`, `UNSUPPORTED` de `public/format.js`; as funções de formatação existentes.
- Produces (`public/latest.js`): `latestOnly(fn): (...args) => Promise<{stale:true}|{stale:false,value}>`; só a chamada mais recente devolve valor/erro, as anteriores resolvem `{stale:true}`.
- Produces: a página final.

- [ ] **Step 1: Escrever os testes que falham**

`test/latest.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { latestOnly } from '../public/latest.js';
import { deferred } from './helpers.js';

test('latestOnly: a resposta mais antiga, mesmo chegando depois, é descartada', async () => {
  const first = deferred();
  const second = deferred();
  const gates = [first, second];
  let n = 0;
  const run = latestOnly(() => gates[n++].promise);
  const a = run('a');
  const b = run('b');
  second.resolve('B');
  assert.deepEqual(await b, { stale: false, value: 'B' });
  first.resolve('A');
  assert.deepEqual(await a, { stale: true });
});

test('latestOnly: uma chamada única devolve o valor', async () => {
  const run = latestOnly(async (x) => x * 2);
  assert.deepEqual(await run(21), { stale: false, value: 42 });
});

test('latestOnly: erro da chamada mais recente propaga-se; o das antigas é ignorado', async () => {
  const first = deferred();
  const second = deferred();
  const gates = [first, second];
  let n = 0;
  const run = latestOnly(() => gates[n++].promise);
  const a = run();
  const b = run();
  first.reject(new Error('antigo'));
  assert.deepEqual(await a, { stale: true });
  second.reject(new Error('recente'));
  await assert.rejects(b, /recente/);
});
```

`test/ui-contract.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = new URL('../public/', import.meta.url).pathname;
const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));

test('todos os ids que os scripts da página procuram existem no index.html', () => {
  const missing = [];
  for (const file of readdirSync(PUBLIC).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(PUBLIC, file), 'utf8');
    const used = [...src.matchAll(/(?:\$|getElementById)\('([\w-]+)'\)/g)].map((m) => m[1]);
    used.forEach((id) => { if (!htmlIds.has(id)) missing.push(`${file}: #${id}`); });
  }
  assert.deepEqual(missing, []);
});

test('os módulos importados pela página existem', () => {
  const files = new Set(readdirSync(PUBLIC));
  const bad = [];
  for (const file of readdirSync(PUBLIC).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(PUBLIC, file), 'utf8');
    for (const m of src.matchAll(/from '\.\/([\w-]+\.js)'/g)) {
      if (!files.has(m[1])) bad.push(`${file} -> ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});
```

- [ ] **Step 2: Correr os testes e confirmar que falham**

Run: `node --test test/latest.test.js test/ui-contract.test.js`
Expected: `latest.test.js` FAIL (módulo em falta). `ui-contract.test.js` pode passar já (a página atual é consistente consigo própria); fica como rede de segurança para os passos seguintes.

- [ ] **Step 3: Criar `public/latest.js`**

```js
export function latestOnly(fn) {
  let seq = 0;
  return async (...args) => {
    const mine = ++seq;
    try {
      const value = await fn(...args);
      return mine === seq ? { stale: false, value } : { stale: true };
    } catch (err) {
      if (mine === seq) throw err;
      return { stale: true };
    }
  };
}
```

- [ ] **Step 4: Criar `public/api.js`**

```js
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
```

- [ ] **Step 5: Substituir `public/index.html`**

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
  <header class="marquee" id="marquee" aria-label="Cotações em movimento" hidden>
    <div class="marquee-track" id="track"></div>
  </header>

  <main>
    <div class="topbar">
      <h1>Ticker de Ações</h1>
      <div class="actions">
        <span id="status" class="status" data-level="warn">A carregar…</span>
        <button id="add-btn" class="btn primary" type="button">+ Adicionar ações</button>
        <button id="settings-btn" class="btn" type="button">Definições</button>
      </div>
    </div>

    <p id="notice" class="notice" role="alert" hidden></p>

    <section id="empty" class="empty" hidden>
      <h2>Ainda não escolheu nenhuma ação</h2>
      <p>Pesquise por nome ou símbolo e escolha o mercado.</p>
      <button id="add-first" class="btn primary" type="button">Adicionar a primeira ação</button>
    </section>

    <div id="grid"></div>
  </main>

  <dialog id="add-dialog" aria-labelledby="add-title">
    <form method="dialog" class="dlg-head">
      <h2 id="add-title">Adicionar ações</h2>
      <button class="btn" value="close" aria-label="Fechar">✕</button>
    </form>
    <div class="dlg-body">
      <label>Mercado
        <select id="market-select"><option value="all">Todos os mercados</option></select>
      </label>
      <label>Pesquisar
        <input id="search-input" type="search" autocomplete="off"
               placeholder="Nome ou símbolo (ex.: micron, NVDA)">
      </label>
      <p id="search-msg" class="msg" role="status"></p>
      <ul id="results" class="results"></ul>
      <p id="limit-msg" class="msg"></p>
    </div>
  </dialog>

  <dialog id="settings-dialog" aria-labelledby="settings-title">
    <form method="dialog" class="dlg-head">
      <h2 id="settings-title">Definições</h2>
      <button class="btn" value="close" aria-label="Fechar">✕</button>
    </form>
    <div class="dlg-body">
      <fieldset>
        <legend>Fonte de dados</legend>
        <div id="provider-options"></div>
      </fieldset>
      <label>Chave do Finnhub
        <input id="key-input" type="password" autocomplete="off" placeholder="Cole aqui a sua chave">
      </label>
      <p class="hint">Crie uma conta gratuita em
        <a href="https://finnhub.io/register" target="_blank" rel="noopener">finnhub.io</a>.
        A chave fica só neste computador. O plano gratuito só cobre ações dos EUA.</p>
      <p class="warn">O Yahoo Finance é uma fonte não oficial: pode deixar de funcionar e os dados podem ter atraso.</p>
      <p id="settings-msg" class="msg" role="status"></p>
      <button id="settings-save" class="btn primary" type="button">Guardar</button>
    </div>
  </dialog>

  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 6: Criar `public/view.js`**

```js
import {
  formatPrice, formatPct, formatChange, direction, sparkPoints, stateText,
} from './format.js';

const MARQUEE_PX_PER_S = 60;
const SPARK_W = 120;
const SPARK_H = 32;
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

let signature = '';
let marqueeFitted = false;
const lastPrice = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildTick(q, group) {
  const item = el('span', 'tick');
  item.dataset.symbol = q.symbol;
  item.style.setProperty('--accent', group.color);
  item.append(
    el('span', 'badge', group.market.toUpperCase()),
    el('span', 'sym', q.symbol),
    el('span', 'px', '—'),
    el('span', 'pct', ''),
  );
  return item;
}

function buildCard(q, onRemove) {
  const card = el('article', 'card');
  card.dataset.symbol = q.symbol;
  const head = el('div', 'card-head');
  head.append(el('span', 'name', q.name), el('span', 'sym', q.symbol));
  const remove = el('button', 'remove', '✕');
  remove.type = 'button';
  remove.title = `Retirar ${q.name}`;
  remove.setAttribute('aria-label', `Retirar ${q.name}`);
  remove.addEventListener('click', () => onRemove(q.symbol));
  const row = el('div', 'row');
  row.append(el('span', 'pct', ''), el('span', 'chg', ''));
  const foot = el('div', 'foot');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', `0 0 ${SPARK_W} ${SPARK_H}`);
  svg.append(document.createElementNS(SVG_NS, 'polyline'));
  foot.append(el('span', 'state', ''), svg);
  card.append(head, remove, el('div', 'price', '—'), row, foot);
  return card;
}

function build(groups, onRemove) {
  const track = $('track');
  track.replaceChildren();
  for (let copy = 0; copy < 2; copy += 1) {
    const g = el('div', 'marquee-group');
    if (copy === 1) g.setAttribute('aria-hidden', 'true');
    groups.forEach((group) => group.quotes.forEach((q) => g.append(buildTick(q, group))));
    track.append(g);
  }
  const grid = $('grid');
  grid.replaceChildren();
  groups.forEach((group) => {
    const section = el('section', 'sector');
    section.style.setProperty('--accent', group.color);
    section.append(el('h2', '', group.label));
    const cards = el('div', 'cards');
    group.quotes.forEach((q) => cards.append(buildCard(q, onRemove)));
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

function update(quotes, serverTime) {
  quotes.forEach((q) => {
    document.querySelectorAll(`[data-symbol="${CSS.escape(q.symbol)}"]`).forEach((root) => {
      root.classList.toggle('stale', q.stale);
      setText(root, '.state', stateText(q, serverTime));
      if (!q.hasData) {
        root.dataset.dir = 'flat';
        root.dataset.open = 'false';
        setText(root, '.px, .price', '—');
        setText(root, '.pct', 'sem dados');
        setText(root, '.chg', '');
        root.querySelector('polyline')?.setAttribute('points', '');
        return;
      }
      root.dataset.dir = direction(q.changePct);
      root.dataset.open = String(q.marketOpen && !q.stale);
      setText(root, '.px, .price', formatPrice(q.price, q.currency));
      setText(root, '.pct', formatPct(q.changePct));
      setText(root, '.chg', formatChange(q.change, q.currency));
      root.querySelector('polyline')?.setAttribute('points', sparkPoints(q.series, SPARK_W, SPARK_H));

      const prev = lastPrice.get(q.symbol);
      if (prev !== undefined && prev !== q.price) flash(root, q.price > prev ? 'flash-up' : 'flash-down');
    });
    if (q.hasData) lastPrice.set(q.symbol, q.price);
  });
}

// Repete o conteúdo da faixa até cobrir a largura da janela; a animação percorre metade da faixa.
function fitMarquee() {
  const track = $('track');
  const groupWidth = track.firstElementChild?.getBoundingClientRect().width ?? 0;
  if (!groupWidth) return;
  const half = Math.max(1, Math.ceil(window.innerWidth / groupWidth));
  while (track.children.length < half * 2) {
    const clone = track.firstElementChild.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    track.append(clone);
  }
  track.style.setProperty('--dur', `${Math.max((groupWidth * half) / MARQUEE_PX_PER_S, 10)}s`);
}

export function render(payload, { onRemove }) {
  const quotes = payload.groups.flatMap((g) => g.quotes);
  const hasItems = quotes.length > 0;
  $('empty').hidden = hasItems;
  $('marquee').hidden = !hasItems;

  const sig = payload.groups.map((g) => `${g.market}:${g.quotes.map((q) => q.symbol).join(',')}`).join('|');
  if (sig !== signature) {
    build(payload.groups, onRemove);
    signature = sig;
    marqueeFitted = false;
  }
  update(quotes, payload.serverTime);

  const anyData = quotes.some((q) => q.hasData);
  if (hasItems && anyData && !marqueeFitted) {
    fitMarquee();
    marqueeFitted = true;
  }
  return { hasItems, pending: quotes.some((q) => !q.hasData && !q.error) };
}
```

- [ ] **Step 7: Criar `public/panels.js`**

```js
import { search, getSettings, putSettings } from './api.js';
import { latestOnly } from './latest.js';

const $ = (id) => document.getElementById(id);
const DEBOUNCE_MS = 300;

function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}

export function initAddDialog({ getItems, maxItems, onAdd }) {
  const dialog = $('add-dialog');
  const select = $('market-select');
  const input = $('search-input');
  const msg = $('search-msg');
  const list = $('results');
  const limitMsg = $('limit-msg');
  const runSearch = latestOnly(search);
  let results = [];
  let debounce = null;

  const isIn = (symbol) => getItems().some((i) => i.symbol === symbol);
  const full = () => getItems().length >= maxItems;

  function renderResults() {
    list.replaceChildren();
    limitMsg.textContent = full()
      ? `Chegou ao limite de ${maxItems} ações. Retire alguma para adicionar mais.`
      : '';
    results.forEach((r) => {
      const li = document.createElement('li');
      const info = document.createElement('div');
      info.className = 'result-info';
      const name = document.createElement('strong');
      name.textContent = r.name;
      const meta = document.createElement('span');
      meta.textContent = `${r.symbol} · ${r.marketLabel}`;
      info.append(name, meta);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      const already = isIn(r.symbol);
      btn.textContent = already ? 'Já na lista' : 'Adicionar';
      btn.disabled = already || full();
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await onAdd({ symbol: r.symbol, name: r.name, market: r.market });
          msg.textContent = '';
        } catch (err) {
          msg.textContent = `Não foi possível adicionar: ${err.message}`;
        }
        renderResults();
      });
      li.append(info, btn);
      list.append(li);
    });
  }

  async function doSearch() {
    const q = input.value.trim();
    if (q.length < 2) {
      results = [];
      msg.textContent = q.length ? 'Escreva pelo menos 2 caracteres.' : '';
      renderResults();
      return;
    }
    msg.textContent = 'A pesquisar…';
    try {
      const out = await runSearch(q, select.value);
      if (out.stale) return;
      results = out.value.results;
      msg.textContent = results.length ? '' : 'Sem resultados.';
    } catch (err) {
      results = [];
      msg.textContent = `Não foi possível pesquisar. Tente outra vez. (${err.message})`;
    }
    renderResults();
  }

  async function loadMarkets() {
    const s = await getSettings();
    const keep = select.value;
    select.replaceChildren(
      new Option('Todos os mercados', 'all'),
      ...s.markets.map((m) => new Option(m.label, m.id)),
    );
    select.value = [...select.options].some((o) => o.value === keep) ? keep : 'all';
  }

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(doSearch, DEBOUNCE_MS);
  });
  select.addEventListener('change', doSearch);
  closeOnBackdrop(dialog);

  return {
    async open() {
      try {
        await loadMarkets();
      } catch {
        msg.textContent = 'Não foi possível carregar os mercados.';
      }
      dialog.showModal();
      input.focus();
      renderResults();
    },
  };
}

export function initSettingsDialog({ onSaved }) {
  const dialog = $('settings-dialog');
  const box = $('provider-options');
  const keyInput = $('key-input');
  const msg = $('settings-msg');
  closeOnBackdrop(dialog);

  async function load() {
    const s = await getSettings();
    box.replaceChildren();
    s.providers.forEach((p) => {
      const label = document.createElement('label');
      label.className = 'radio';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'provider';
      radio.value = p.id;
      radio.checked = p.id === s.provider;
      const text = document.createElement('span');
      text.textContent = p.label;
      label.append(radio, text);
      box.append(label);
    });
    keyInput.value = '';
    keyInput.placeholder = s.hasKey ? 'Chave guardada (deixe vazio para a manter)' : 'Cole aqui a sua chave';
    msg.textContent = s.notice ?? '';
  }

  $('settings-save').addEventListener('click', async () => {
    const provider = box.querySelector('input[name="provider"]:checked')?.value;
    const update = { provider };
    if (keyInput.value.trim()) update.apiKey = keyInput.value.trim();
    try {
      await putSettings(update);
      dialog.close();
      await onSaved();
    } catch (err) {
      msg.textContent = `Não foi possível guardar: ${err.message}`;
    }
  });

  return {
    async open() {
      try {
        await load();
      } catch {
        msg.textContent = 'Não foi possível carregar as definições.';
      }
      dialog.showModal();
    },
  };
}
```

- [ ] **Step 8: Substituir `public/app.js`**

```js
import { ageText } from './format.js';
import { getQuotes, putWatchlist } from './api.js';
import { render } from './view.js';
import { initAddDialog, initSettingsDialog } from './panels.js';

const REFRESH_MS = 30_000;
const RETRY_MS = 2_000;
const STALE_MS = 120_000;
const MAX_ITEMS = 30;

const $ = (id) => document.getElementById(id);
let items = [];
let timer = null;
let lastDataAt = null; // relógio local (ms) do dado mais recente
let connectionLost = false;

function setNotice(text) {
  $('notice').hidden = !text;
  $('notice').textContent = text ?? '';
}

function renderStatus() {
  const s = $('status');
  if (connectionLost) {
    s.textContent = 'Sem ligação ao servidor';
    s.dataset.level = 'error';
  } else if (items.length === 0) {
    s.textContent = 'Lista vazia';
    s.dataset.level = 'ok';
  } else if (lastDataAt === null) {
    s.textContent = 'À espera de dados…';
    s.dataset.level = 'warn';
  } else {
    const age = Date.now() - lastDataAt;
    s.textContent = `Atualizado ${ageText(Math.round(age / 1000))}`;
    s.dataset.level = age > STALE_MS ? 'warn' : 'ok';
  }
}

async function saveItems(next) {
  const res = await putWatchlist(next);
  items = res.items;
  await refresh();
}

async function removeItem(symbol) {
  try {
    await saveItems(items.filter((i) => i.symbol !== symbol));
  } catch (err) {
    setNotice(`Não foi possível retirar a ação: ${err.message}`);
  }
}

async function refresh() {
  clearTimeout(timer);
  let pending = false;
  try {
    const payload = await getQuotes();
    const quotes = payload.groups.flatMap((g) => g.quotes);
    items = quotes.map(({ symbol, name, market }) => ({ symbol, name, market }));
    pending = render(payload, { onRemove: removeItem }).pending;
    const newest = Math.max(0, ...quotes.map((q) => q.updatedAt ?? 0));
    lastDataAt = newest ? Date.now() - (payload.serverTime - newest) : null;
    connectionLost = false;
    setNotice(payload.notice);
  } catch {
    connectionLost = true;
  }
  renderStatus();
  // Ações novas ainda sem primeira cotação: voltar a tentar depressa.
  timer = setTimeout(refresh, pending ? RETRY_MS : REFRESH_MS);
}

const addDialog = initAddDialog({
  getItems: () => items,
  maxItems: MAX_ITEMS,
  onAdd: (item) => saveItems([...items, item]),
});
const settingsDialog = initSettingsDialog({ onSaved: refresh });

$('add-btn').addEventListener('click', addDialog.open);
$('add-first').addEventListener('click', addDialog.open);
$('settings-btn').addEventListener('click', settingsDialog.open);

refresh();
setInterval(renderStatus, 1000);
```

- [ ] **Step 9: Acrescentar estilos a `public/style.css`**

Acrescentar no fim do ficheiro:
```css
/* Botões e barra de ações */
.actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.btn {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
}
.btn:hover:not(:disabled) { border-color: var(--muted); }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn.primary { background: #1d4ed8; border-color: #1d4ed8; }
.btn.primary:hover:not(:disabled) { background: #2563eb; border-color: #2563eb; }
.btn:focus-visible, .remove:focus-visible, input:focus-visible, select:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}

/* Avisos e estado vazio */
.notice {
  margin: 12px 0 0;
  padding: 10px 14px;
  border: 1px solid var(--warn);
  border-radius: 8px;
  color: var(--warn);
  font-size: 13px;
}
.empty { margin-top: 48px; text-align: center; color: var(--muted); }
.empty h2 { color: var(--text); font-size: 18px; margin: 0 0 6px; }

/* Remover ação */
.card { position: relative; }
.remove {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 12px;
  line-height: 1;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
}
.card:hover .remove, .card:focus-within .remove { opacity: 1; }
.remove:hover { color: var(--down); border-color: var(--line); }
@media (hover: none) { .remove { opacity: 1; } }
.card-head { padding-right: 28px; }

/* Painéis */
dialog {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  padding: 0;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
}
dialog::backdrop { background: rgba(0, 0, 0, 0.6); }
.dlg-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--line); }
.dlg-head h2 { margin: 0; font-size: 16px; }
.dlg-body { display: grid; gap: 12px; padding: 16px 18px 18px; }
.dlg-body label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
.dlg-body input[type="search"], .dlg-body input[type="password"], .dlg-body select {
  font: inherit;
  font-size: 14px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 10px;
}
fieldset { margin: 0; padding: 0; border: 0; }
legend { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.radio { display: flex !important; flex-direction: row; align-items: center; gap: 8px; color: var(--text) !important; padding: 4px 0; }
.msg { margin: 0; min-height: 1.2em; font-size: 13px; color: var(--muted); }
.hint, .warn { margin: 0; font-size: 12px; color: var(--muted); }
.warn { color: var(--warn); }
.hint a { color: #93c5fd; }
.results { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; max-height: 320px; overflow-y: auto; }
.results li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 10px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; }
.result-info { display: grid; min-width: 0; }
.result-info strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-info span { font-size: 12px; color: var(--muted); font-family: var(--mono); }
```

- [ ] **Step 10: Correr os testes e confirmar que passam**

Run: `npm test`
Expected: PASS (todos, incluindo `latest.test.js` e `ui-contract.test.js`)

- [ ] **Step 11: Verificação no browser, com interação real**

Instalar o controlo do Chrome fora do projeto (nada entra no repositório):
```bash
mkdir -p /tmp/e2e && cd /tmp/e2e && npm init -y >/dev/null && npm i puppeteer-core >/dev/null
```
Criar `/tmp/e2e/run.mjs`:
```js
import puppeteer from 'puppeteer-core';

const base = process.argv[2];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(base);
await page.waitForSelector('#empty:not([hidden])');
await page.screenshot({ path: '/tmp/e2e-1-empty.png' });

await page.click('#add-first');
await page.waitForSelector('#add-dialog[open]');
await page.type('#search-input', 'micron');
await page.waitForSelector('#results li button:not([disabled])', { timeout: 20000 });
await page.screenshot({ path: '/tmp/e2e-2-search.png' });
await page.click('#results li button');
await page.waitForFunction(() => {
  const p = document.querySelector('.card[data-symbol="MU"] .price');
  return p && p.textContent !== '—';
}, { timeout: 30000 });

await page.select('#market-select', 'kr');
await page.$eval('#search-input', (i) => { i.value = ''; });
await page.type('#search-input', 'samsung');
await page.waitForSelector('#results li button:not([disabled])', { timeout: 20000 });
await page.click('#results li button');
await page.waitForSelector('.card[data-symbol="005930.KS"]', { timeout: 20000 });
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 4000));
await page.screenshot({ path: '/tmp/e2e-3-list.png' });

await page.hover('.card[data-symbol="MU"]');
await page.click('.card[data-symbol="MU"] .remove');
await page.waitForFunction(() => !document.querySelector('.card[data-symbol="MU"]'), { timeout: 10000 });

await page.click('#settings-btn');
await page.waitForSelector('#settings-dialog[open]');
await page.screenshot({ path: '/tmp/e2e-4-settings.png' });

console.log(errors.length ? `ERROS NA PÁGINA:\n${errors.join('\n')}` : 'E2E-OK sem erros na consola');
await browser.close();
process.exit(errors.length ? 1 : 0);
```
Arrancar o servidor com definições vazias e correr:
```bash
cd ~/ticker-acoes && rm -f /tmp/ticker-e2e.json && (PORT=3124 TICKER_SETTINGS=/tmp/ticker-e2e.json node server.js > /tmp/e2e-server.log 2>&1 & echo $! > /tmp/e2e-server.pid)
sleep 2 && node /tmp/e2e/run.mjs http://127.0.0.1:3124/
kill $(cat /tmp/e2e-server.pid); rm -f /tmp/ticker-e2e.json
```
Expected: `E2E-OK sem erros na consola`. Abrir as 4 capturas (`/tmp/e2e-1-empty.png` … `e2e-4-settings.png`) e confirmar à vista: estado vazio com o botão; resultados da pesquisa com "Adicionar"; cartões agrupados por mercado ("EUA…" e "Coreia do Sul…") com faixa no topo; painel de definições com as duas fontes, o campo da chave e o aviso do Yahoo. O que **não** se consegue ver numa captura (deslizar da faixa, piscar do preço, janela estreita de telemóvel) fica anotado no registo como não verificado.

- [ ] **Step 12: Commit**

```bash
git add public test/latest.test.js test/ui-contract.test.js
git commit -m "feat: watchlist form, settings panel and per-market view" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Electron, empacotamento e distribuição

**Files:**
- Create: `electron/main.js`, `.github/workflows/release.yml`
- Modify: `package.json`, `README.md`, `.gitignore` (já tem `dist/`)

**Interfaces:**
- Consumes (T4, T5): `createService`, `createApp`.
- Produces: `npm run app` (abre a aplicação), `npm run pack` (gera a pasta da app sem instalador), `npm run dist` (gera `.dmg`/`.exe` da plataforma atual) e o fluxo do GitHub Actions. Variáveis de ambiente de teste: `TICKER_USERDATA` (pasta de dados) e `TICKER_SMOKE=1` (imprime `SMOKE-OK <título>|<botão existe>` e sai).

- [ ] **Step 1: Instalar Electron e electron-builder**

Run: `npm install --save-dev electron electron-builder`
Expected: instala sem erros; `package.json` ganha `devDependencies` e é criado `package-lock.json`.

- [ ] **Step 2: Acrescentar os campos de empacotamento a `package.json`**

Run:
```bash
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.description = "Ticker de ações quase em tempo real";
p.author = "Ticker de Ações";
p.main = "electron/main.js";
p.scripts = {
  start: "node server.js",
  app: "electron .",
  test: "node --test test/*.test.js",
  "check:live": "node test/live.check.js",
  pack: "electron-builder --dir",
  dist: "electron-builder",
};
p.build = {
  appId: "pt.tickeracoes.app",
  productName: "Ticker Acoes",
  files: ["electron/**", "src/**", "public/**", "package.json"],
  mac: { target: [{ target: "dmg", arch: ["arm64", "x64"] }], category: "public.app-category.finance" },
  win: { target: "nsis" },
  nsis: { oneClick: false, perMachine: false },
};
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
'
cat package.json | head -40
```
Expected: `package.json` com `main`, `scripts` (incluindo `app`, `pack`, `dist`), `build` e as `devDependencies`.

- [ ] **Step 3: Criar `electron/main.js`**

```js
import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { createService } from '../src/service.js';
import { createApp } from '../src/app.js';

if (process.env.TICKER_USERDATA) app.setPath('userData', process.env.TICKER_USERDATA);

const isHttps = (target) => /^https:\/\//.test(target);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let service = null;

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => service?.stop());

  app.whenReady().then(async () => {
    service = createService({ settingsFile: path.join(app.getPath('userData'), 'settings.json') });
    const server = createApp(service);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    } catch (err) {
      dialog.showErrorBox('Ticker de Ações', `Não foi possível arrancar o servidor interno: ${err.message}`);
      app.quit();
      return;
    }
    const url = `http://127.0.0.1:${server.address().port}/`;
    service.start();

    win = new BrowserWindow({
      width: 1200,
      height: 900,
      backgroundColor: '#0b0e14',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (isHttps(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, target) => {
      if (target.startsWith(url)) return;
      event.preventDefault();
      if (isHttps(target)) shell.openExternal(target);
    });

    if (process.env.TICKER_SMOKE) {
      win.webContents.once('did-finish-load', async () => {
        const info = await win.webContents.executeJavaScript(
          'document.title + "|" + Boolean(document.getElementById("add-btn"))',
        );
        console.log(`SMOKE-OK ${info}`);
        app.quit();
      });
    }
    win.loadURL(url);
  });
}
```

- [ ] **Step 4: Fumo da aplicação em Electron**

Run: `TICKER_SMOKE=1 TICKER_USERDATA=$(mktemp -d) npx electron . 2>&1 | grep -E "SMOKE-OK|Error|error" | head`
Expected: `SMOKE-OK Ticker de Ações|true` e o comando termina sozinho. Se aparecer um erro de módulo ESM, confirmar que `package.json` tem `"type": "module"` e `"main": "electron/main.js"`.

- [ ] **Step 5: Empacotar e fazer o fumo à aplicação empacotada**

Run:
```bash
npm run pack 2>&1 | tail -5
APP=$(ls -d dist/mac*/"Ticker Acoes.app" | head -1); echo "$APP"
TICKER_SMOKE=1 TICKER_USERDATA=$(mktemp -d) "$APP/Contents/MacOS/Ticker Acoes" 2>&1 | grep -E "SMOKE-OK|Error" | head
```
Expected: `dist/mac-arm64/Ticker Acoes.app` (ou `mac/`) criado e `SMOKE-OK Ticker de Ações|true` a partir da app empacotada. Isto prova que o servidor, o código ESM e a pasta `public/` vão corretamente dentro do pacote.

- [ ] **Step 6: Criar `.github/workflows/release.yml`**

```yaml
name: Instaladores

on:
  push:
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npx electron-builder --publish never
      - uses: actions/upload-artifact@v4
        with:
          name: instaladores-${{ matrix.os }}
          path: |
            dist/*.dmg
            dist/*.exe

  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true
      - env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "${{ github.ref_name }}" artifacts/* --repo "${{ github.repository }}" --generate-notes
```

- [ ] **Step 7: Reescrever `README.md`**

````markdown
# Ticker de Ações

Aplicação para Mac e Windows que mostra, quase em tempo real, as ações que escolher: faixa deslizante no topo e cartões com preço, variação e gráfico do dia. Os dados ficam só no seu computador.

## Instalar (utilizadores)

1. Descarregue o instalador da última versão em **Releases**: `.dmg` (Mac) ou `.exe` (Windows).
2. Abra-o e instale. Como a aplicação não está assinada, o sistema mostra um aviso:
   - **Mac:** clique com o botão direito na aplicação → **Abrir** → **Abrir**. Se disser que está "danificada", abra o Terminal e corra `xattr -cr "/Applications/Ticker Acoes.app"`.
   - **Windows:** **Mais informações** → **Executar mesmo assim**.
3. Clique em **+ Adicionar ações**, escolha o mercado, pesquise por nome ou símbolo (por exemplo "micron" ou "NVDA") e adicione. Até 30 ações.

## Fonte dos dados

- **Yahoo Finance (por defeito, sem chave):** todos os mercados (EUA, Seul, Londres, Frankfurt, Paris, Amesterdão, Lisboa, Tóquio, Hong Kong). **Não é uma fonte oficial:** pode deixar de funcionar sem aviso, os termos do Yahoo não preveem redistribuição e os preços podem ter atraso.
- **Finnhub (chave própria):** fonte oficial. Crie uma conta gratuita em finnhub.io, copie a chave e cole-a em **Definições**. O plano gratuito só cobre ações dos EUA e não tem gráfico do dia.

Nada é recolhido sobre si: a aplicação só contacta a fonte de dados que escolher.

## Desenvolvimento

```bash
npm install
npm test             # testes automáticos (sem rede)
npm run check:live   # confirma que a pesquisa e as cotações funcionam no Yahoo
npm run app          # abre a aplicação Electron
npm start            # só o servidor, em http://127.0.0.1:3000 (para o browser)
npm run pack         # gera a aplicação sem instalador, em dist/
npm run dist         # gera o instalador da plataforma atual, em dist/
```

Requer Node.js 22.

## Publicar uma versão

Crie um repositório no GitHub, envie o código e crie uma etiqueta: `git tag v1.0.0 && git push --tags`. O fluxo em `.github/workflows/release.yml` compila o instalador do Mac e o do Windows e publica-os numa Release.
````

- [ ] **Step 8: Verificação final**

Run: `npm test && npm run check:live`
Expected: todos os testes passam e as 6 sondas do `check:live` dão `OK`.

Verificação à mão (a registar como não automatizada): abrir `npm run app`, adicionar uma ação de cada um de dois mercados, retirar uma, mudar para Finnhub sem chave (aparece o aviso) e voltar ao Yahoo. O instalador `.exe` e o fluxo do GitHub só se podem verificar depois de o repositório existir no GitHub.

- [ ] **Step 9: Commit**

```bash
git add electron .github package.json package-lock.json README.md
git commit -m "feat: Electron shell, packaging config, release workflow, user README" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
