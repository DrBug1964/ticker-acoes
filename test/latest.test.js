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
