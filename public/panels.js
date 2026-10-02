import { search, getSettings, putSettings } from './api.js';
import { latestOnly } from './latest.js';

const $ = (id) => document.getElementById(id);
const DEBOUNCE_MS = 300;

function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}

export function initAddDialog({ getItems, maxItems, onAdd }) {
  const dialog = $('add-dialog');
  const select = $('market-select');
  const input = $('search-input');
  const msg = $('search-msg');
  const list = $('results');
  const limitMsg = $('limit-msg');
  const runSearch = latestOnly(search);
  let results = [];
  let debounce = null;

  const isIn = (symbol) => getItems().some((i) => i.symbol === symbol);
  const full = () => getItems().length >= maxItems;

  function renderResults() {
    list.replaceChildren();
    limitMsg.textContent = full()
      ? `Chegou ao limite de ${maxItems} ações. Retire alguma para adicionar mais.`
      : '';
    results.forEach((r) => {
      const li = document.createElement('li');
      const info = document.createElement('div');
      info.className = 'result-info';
      const name = document.createElement('strong');
      name.textContent = r.name;
      const meta = document.createElement('span');
      meta.textContent = `${r.symbol} · ${r.marketLabel}`;
      info.append(name, meta);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      const already = isIn(r.symbol);
      btn.textContent = already ? 'Já na lista' : 'Adicionar';
      btn.disabled = already || full();
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await onAdd({ symbol: r.symbol, name: r.name, market: r.market });
          msg.textContent = '';
        } catch (err) {
          msg.textContent = `Não foi possível adicionar: ${err.message}`;
        }
        renderResults();
      });
      li.append(info, btn);
      list.append(li);
    });
  }

  async function doSearch() {
    const q = input.value.trim();
    if (q.length < 2) {
      results = [];
      msg.textContent = q.length ? 'Escreva pelo menos 2 caracteres.' : '';
      renderResults();
      return;
    }
    msg.textContent = 'A pesquisar…';
    try {
      const out = await runSearch(q, select.value);
      if (out.stale) return;
      results = out.value.results;
      msg.textContent = results.length ? '' : 'Sem resultados.';
    } catch (err) {
      results = [];
      msg.textContent = `Não foi possível pesquisar. Tente outra vez. (${err.message})`;
    }
    renderResults();
  }

  async function loadMarkets() {
    const s = await getSettings();
    const keep = select.value;
    select.replaceChildren(
      new Option('Todos os mercados', 'all'),
      ...s.markets.map((m) => new Option(m.label, m.id)),
    );
    select.value = [...select.options].some((o) => o.value === keep) ? keep : 'all';
  }

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(doSearch, DEBOUNCE_MS);
  });
  select.addEventListener('change', doSearch);
  closeOnBackdrop(dialog);

  return {
    async open() {
      try {
        await loadMarkets();
      } catch {
        msg.textContent = 'Não foi possível carregar os mercados.';
      }
      dialog.showModal();
      input.focus();
      renderResults();
    },
  };
}

export function initSettingsDialog({ onSaved }) {
  const dialog = $('settings-dialog');
  const box = $('provider-options');
  const keyInput = $('key-input');
  const msg = $('settings-msg');
  closeOnBackdrop(dialog);

  async function load() {
    const s = await getSettings();
    box.replaceChildren();
    s.providers.forEach((p) => {
      const label = document.createElement('label');
      label.className = 'radio';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'provider';
      radio.value = p.id;
      radio.checked = p.id === s.provider;
      const text = document.createElement('span');
      text.textContent = p.label;
      label.append(radio, text);
      box.append(label);
    });
    keyInput.value = '';
    keyInput.placeholder = s.hasKey ? 'Chave guardada (deixe vazio para a manter)' : 'Cole aqui a sua chave';
    msg.textContent = s.notice ?? '';
  }

  $('settings-save').addEventListener('click', async () => {
    const provider = box.querySelector('input[name="provider"]:checked')?.value;
    const update = { provider };
    if (keyInput.value.trim()) update.apiKey = keyInput.value.trim();
    try {
      await putSettings(update);
      dialog.close();
      await onSaved();
    } catch (err) {
      msg.textContent = `Não foi possível guardar: ${err.message}`;
    }
  });

  return {
    async open() {
      try {
        await load();
      } catch {
        msg.textContent = 'Não foi possível carregar as definições.';
      }
      dialog.showModal();
    },
  };
}
