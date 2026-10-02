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
