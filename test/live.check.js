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
