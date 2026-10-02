import { ageText } from './format.js';
import { getQuotes, putWatchlist } from './api.js';
import { render } from './view.js';
import { initAddDialog, initSettingsDialog } from './panels.js';

const REFRESH_MS = 30_000;
const RETRY_MS = 2_000;
const STALE_MS = 120_000;
const MAX_ITEMS = 30;

const $ = (id) => document.getElementById(id);
let items = [];
let timer = null;
let lastDataAt = null; // relógio local (ms) do dado mais recente
let connectionLost = false;

function setNotice(text) {
  $('notice').hidden = !text;
  $('notice').textContent = text ?? '';
}

function renderStatus() {
  const s = $('status');
  if (connectionLost) {
    s.textContent = 'Sem ligação ao servidor';
    s.dataset.level = 'error';
  } else if (items.length === 0) {
    s.textContent = 'Lista vazia';
    s.dataset.level = 'ok';
  } else if (lastDataAt === null) {
    s.textContent = 'À espera de dados…';
    s.dataset.level = 'warn';
  } else {
    const age = Date.now() - lastDataAt;
    s.textContent = `Atualizado ${ageText(Math.round(age / 1000))}`;
    s.dataset.level = age > STALE_MS ? 'warn' : 'ok';
  }
}

async function saveItems(next) {
  const res = await putWatchlist(next);
  items = res.items;
  await refresh();
}

async function removeItem(symbol) {
  try {
    await saveItems(items.filter((i) => i.symbol !== symbol));
  } catch (err) {
    setNotice(`Não foi possível retirar a ação: ${err.message}`);
  }
}

async function refresh() {
  clearTimeout(timer);
  let pending = false;
  try {
    const payload = await getQuotes();
    const quotes = payload.groups.flatMap((g) => g.quotes);
    items = quotes.map(({ symbol, name, market }) => ({ symbol, name, market }));
    pending = render(payload, { onRemove: removeItem }).pending;
    const newest = Math.max(0, ...quotes.map((q) => q.updatedAt ?? 0));
    lastDataAt = newest ? Date.now() - (payload.serverTime - newest) : null;
    connectionLost = false;
    setNotice(payload.notice);
  } catch {
    connectionLost = true;
  }
  renderStatus();
  // Ações novas ainda sem primeira cotação: voltar a tentar depressa.
  timer = setTimeout(refresh, pending ? RETRY_MS : REFRESH_MS);
}

const addDialog = initAddDialog({
  getItems: () => items,
  maxItems: MAX_ITEMS,
  onAdd: (item) => saveItems([...items, item]),
});
const settingsDialog = initSettingsDialog({ onSaved: refresh });

$('add-btn').addEventListener('click', addDialog.open);
$('add-first').addEventListener('click', addDialog.open);
$('settings-btn').addEventListener('click', settingsDialog.open);

refresh();
setInterval(renderStatus, 1000);
