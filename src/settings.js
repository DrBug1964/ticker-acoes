import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { marketById } from './markets.js';

export const MAX_WATCHLIST = 30;
export const PROVIDERS = ['yahoo', 'finnhub'];

export class ValidationError extends Error {}

const defaults = () => ({ version: 1, provider: 'yahoo', apiKey: '', watchlist: [] });

export function validateWatchlist(items) {
  if (!Array.isArray(items)) throw new ValidationError('A lista tem de ser um array');
  if (items.length > MAX_WATCHLIST) {
    throw new ValidationError(`No máximo ${MAX_WATCHLIST} ações por lista`);
  }
  const seen = new Set();
  return items.map((it) => {
    const symbol = typeof it?.symbol === 'string' ? it.symbol.trim().toUpperCase() : '';
    if (!symbol || symbol.length > 20 || !/^[A-Z0-9.^=-]+$/.test(symbol)) {
      throw new ValidationError('Símbolo inválido');
    }
    if (!marketById(it.market)) throw new ValidationError(`Mercado desconhecido: ${it.market}`);
    if (seen.has(symbol)) throw new ValidationError(`Símbolo repetido: ${symbol}`);
    seen.add(symbol);
    const name = typeof it.name === 'string' ? it.name.trim().slice(0, 80) : '';
    return { symbol, name: name || symbol, market: it.market };
  });
}

export function validateSettingsUpdate(update) {
  if (typeof update !== 'object' || update === null || Array.isArray(update)) {
    throw new ValidationError('Pedido inválido');
  }
  const out = {};
  if ('provider' in update) {
    if (!PROVIDERS.includes(update.provider)) throw new ValidationError('Fonte de dados desconhecida');
    out.provider = update.provider;
  }
  if ('apiKey' in update) {
    const key = typeof update.apiKey === 'string' ? update.apiKey.trim() : null;
    if (key === null || key.length > 200 || /\s/.test(key)) throw new ValidationError('Chave inválida');
    out.apiKey = key;
  }
  return out;
}

function normalize(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('formato');
  const watchlist = [];
  for (const it of Array.isArray(data.watchlist) ? data.watchlist : []) {
    if (watchlist.length >= MAX_WATCHLIST) break;
    try {
      const [ok] = validateWatchlist([it]);
      if (!watchlist.some((w) => w.symbol === ok.symbol)) watchlist.push(ok);
    } catch {
      // item inválido: descartado
    }
  }
  return {
    version: 1,
    provider: PROVIDERS.includes(data.provider) ? data.provider : 'yahoo',
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
    watchlist,
  };
}

export function loadSettings(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return defaults();
  }
  try {
    return normalize(JSON.parse(raw));
  } catch {
    try {
      copyFileSync(file, `${file}.bak`);
    } catch {
      // sem cópia: continua com os valores por defeito
    }
    return defaults();
  }
}

export function saveSettings(file, settings) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2));
  renameSync(tmp, file);
}
