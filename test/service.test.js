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
