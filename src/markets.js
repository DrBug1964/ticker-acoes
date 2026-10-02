export const MARKETS = [
  { id: 'us', label: 'EUA (NASDAQ e NYSE)', codes: ['NMS', 'NGM', 'NCM', 'NYQ', 'PCX', 'ASE'], color: '#4da3ff' },
  { id: 'kr', label: 'Coreia do Sul (Seul)', codes: ['KSC', 'KOE'], color: '#a78bfa' },
  { id: 'uk', label: 'Londres', codes: ['LSE'], color: '#f5c542' },
  { id: 'de', label: 'Alemanha (XETRA e Frankfurt)', codes: ['GER', 'FRA'], color: '#fb923c' },
  { id: 'fr', label: 'Paris', codes: ['PAR'], color: '#34d399' },
  { id: 'nl', label: 'Amesterdão', codes: ['AMS'], color: '#f472b6' },
  { id: 'pt', label: 'Lisboa', codes: ['LIS'], color: '#22d3ee' },
  { id: 'jp', label: 'Tóquio', codes: ['JPX'], color: '#f87171' },
  { id: 'hk', label: 'Hong Kong', codes: ['HKG'], color: '#a3e635' },
];

export const marketById = (id) => MARKETS.find((m) => m.id === id);

export const marketForExchange = (code) =>
  MARKETS.find((m) => m.codes.includes(code))?.id ?? null;
