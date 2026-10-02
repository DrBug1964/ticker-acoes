import test from 'node:test';
import assert from 'node:assert/strict';
import { latestOnly, serial } from '../public/latest.js';
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

test('serial executa as tarefas em ordem, uma de cada vez, e continua depois de um erro', async () => {
  const run = serial();
  const order = [];
  const gate = deferred();
  const a = run(async () => { order.push('a1'); await gate.promise; order.push('a2'); return 'A'; });
  const b = run(async () => { order.push('b'); throw new Error('falhou'); });
  const c = run(async () => { order.push('c'); return 'C'; });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(order, ['a1']);
  gate.resolve();
  assert.equal(await a, 'A');
  await assert.rejects(b, /falhou/);
  assert.equal(await c, 'C');
  assert.deepEqual(order, ['a1', 'a2', 'b', 'c']);
});
