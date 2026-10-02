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
