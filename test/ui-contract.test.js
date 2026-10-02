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
