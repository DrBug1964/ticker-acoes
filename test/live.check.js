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
