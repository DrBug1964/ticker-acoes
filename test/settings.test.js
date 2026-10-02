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
