import { createYahooProvider } from './yahoo.js';
import { createFinnhubProvider } from './finnhub.js';

export const PROVIDER_INFO = [
  { id: 'yahoo', label: 'Yahoo Finance (sem chave, todos os mercados)' },
  { id: 'finnhub', label: 'Finnhub (chave própria, só ações dos EUA)' },
];

export function createProvider(id, { apiKey = '', fetchImpl = fetch } = {}) {
  if (id === 'finnhub') return createFinnhubProvider({ apiKey, fetchImpl });
  return createYahooProvider({ fetchImpl });
}
