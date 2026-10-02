import {
  loadSettings, saveSettings, validateWatchlist, validateSettingsUpdate, ValidationError,
} from './settings.js';
import { QuoteStore, refreshAll, nextDelay } from './store.js';
import { createProvider, PROVIDER_INFO } from './providers/index.js';
import { marketById } from './markets.js';

export const UNSUPPORTED = 'sem dados nesta fonte';

const publicMarkets = (provider) =>
  provider.markets.map(({ id, label, color }) => ({ id, label, color }));

export function createService({
  settingsFile,
  fetchImpl = fetch,
  now = () => Date.now(),
  makeProvider = createProvider,
}) {
  let settings = loadSettings(settingsFile);
  let provider = makeProvider(settings.provider, { apiKey: settings.apiKey, fetchImpl });
  const store = new QuoteStore(settings.watchlist, now);
  let notice = null;
  let delay = provider.refreshMs(settings.watchlist.length);
  let running = false;
  let inFlight = false;
  let again = false;
  let timer = null;

  function persist(next) {
    settings = next;
    saveSettings(settingsFile, settings);
  }

  async function refresh() {
    const current = provider;
    const items = settings.watchlist;
    const supported = new Set(current.markets.map((m) => m.id));
    const usable = items.filter((i) => supported.has(i.market));
    for (const i of items) {
      if (!supported.has(i.market)) store.applyError(i.symbol, new Error(UNSUPPORTED));
    }
    // só a fonte ainda ativa pode escrever no armazém
    const guarded = {
      applyResult: (s, q) => { if (current === provider) store.applyResult(s, q); },
      applyError: (s, e) => { if (current === provider) store.applyError(s, e); },
    };
    const { rateLimited, failed } = await refreshAll(usable, (s) => current.quote(s), guarded);
    if (current !== provider) return { rateLimited: false, notice };
    notice = usable.length > 0 && failed.length === usable.length
      ? store.entries.get(failed[0])?.error ?? null
      : null;
    return { rateLimited, notice };
  }

  async function tick() {
    if (!running) return;
    if (inFlight) { again = true; return; }
    inFlight = true;
    clearTimeout(timer);
    try {
      const out = await refresh();
      delay = nextDelay(delay, out.rateLimited, provider.refreshMs(settings.watchlist.length));
    } catch (err) {
      console.warn(`falha no ciclo de atualização: ${err.message}`);
    } finally {
      inFlight = false;
      if (running) timer = setTimeout(tick, again ? 0 : delay);
      again = false;
    }
  }

  const getSettings = () => ({
    provider: settings.provider,
    hasKey: Boolean(settings.apiKey),
    providers: PROVIDER_INFO,
    markets: publicMarkets(provider),
    notice,
  });

  return {
    refresh,
    start() { running = true; tick(); },
    stop() { running = false; clearTimeout(timer); },

    getWatchlist: () => settings.watchlist.map((i) => ({ ...i })),

    setWatchlist(items) {
      const valid = validateWatchlist(items);
      persist({ ...settings, watchlist: valid });
      store.setTickers(valid);
      tick();
      return valid.map((i) => ({ ...i }));
    },

    getSettings,

    updateSettings(update) {
      const changes = validateSettingsUpdate(update);
      persist({ ...settings, ...changes });
      provider = makeProvider(settings.provider, { apiKey: settings.apiKey, fetchImpl });
      delay = provider.refreshMs(settings.watchlist.length);
      notice = null;
      tick();
      return getSettings();
    },

    async search(query, marketId = 'all') {
      const q = String(query ?? '').trim();
      if (q.length < 2) throw new ValidationError('Escreva pelo menos 2 caracteres');
      if (marketId !== 'all' && !provider.markets.some((m) => m.id === marketId)) {
        throw new ValidationError('Mercado desconhecido');
      }
      const results = await provider.search(q, marketId);
      return results.map((r) => ({ ...r, marketLabel: marketById(r.market)?.label ?? r.market }));
    },

    quotesPayload() {
      const groups = [];
      const byMarket = new Map();
      for (const q of store.snapshot()) {
        let g = byMarket.get(q.market);
        if (!g) {
          const m = marketById(q.market);
          g = { market: m.id, label: m.label, color: m.color, quotes: [] };
          byMarket.set(q.market, g);
          groups.push(g);
        }
        g.quotes.push(q);
      }
      return {
        serverTime: now(),
        groups,
        notice,
        provider: settings.provider,
        hasKey: Boolean(settings.apiKey),
      };
    },
  };
}
