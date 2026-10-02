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
