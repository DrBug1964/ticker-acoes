import {
  formatPrice, formatPct, formatChange, direction, ageText, sparkPoints,
} from './format.js';

const REFRESH_MS = 30_000;
const RETRY_MS = 2_000;
const STALE_MS = 120_000;
const MARQUEE_PX_PER_S = 60;
const SPARK_W = 120;
const SPARK_H = 32;
const SVG_NS = 'http://www.w3.org/2000/svg';

const $ = (id) => document.getElementById(id);
const lastPrice = new Map();
let built = false;
let marqueeFitted = false;
let lastDataAt = null; // relógio local (ms) do dado mais recente
let connectionLost = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildTick(q, sector) {
  const item = el('span', 'tick');
  item.dataset.symbol = q.symbol;
  item.style.setProperty('--accent', sector.color);
  item.append(
    el('span', 'badge', sector.label),
    el('span', 'sym', q.symbol),
    el('span', 'px', '—'),
    el('span', 'pct', ''),
  );
  return item;
}

function buildCard(q) {
  const card = el('article', 'card');
  card.dataset.symbol = q.symbol;
  const head = el('div', 'card-head');
  head.append(el('span', 'name', q.name), el('span', 'sym', q.symbol));
  const row = el('div', 'row');
  row.append(el('span', 'pct', ''), el('span', 'chg', ''));
  const foot = el('div', 'foot');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', `0 0 ${SPARK_W} ${SPARK_H}`);
  svg.append(document.createElementNS(SVG_NS, 'polyline'));
  foot.append(el('span', 'state', ''), svg);
  card.append(head, el('div', 'price', '—'), row, foot);
  return card;
}

function build(sectors, quotes) {
  const sectorById = new Map(sectors.map((s) => [s.id, s]));
  const track = $('track');
  for (let copy = 0; copy < 2; copy += 1) {
    const group = el('div', 'marquee-group');
    if (copy === 1) group.setAttribute('aria-hidden', 'true');
    quotes.forEach((q) => group.append(buildTick(q, sectorById.get(q.sector))));
    track.append(group);
  }
  const grid = $('grid');
  sectors.forEach((sector) => {
    const section = el('section', 'sector');
    section.style.setProperty('--accent', sector.color);
    section.append(el('h2', '', sector.label));
    const cards = el('div', 'cards');
    quotes.filter((q) => q.sector === sector.id).forEach((q) => cards.append(buildCard(q)));
    section.append(cards);
    grid.append(section);
  });
}

const setText = (root, selector, text) =>
  root.querySelectorAll(selector).forEach((n) => { n.textContent = text; });

function flash(root, cls) {
  root.querySelectorAll('.px, .price').forEach((n) => {
    n.classList.remove('flash-up', 'flash-down');
    void n.offsetWidth; // reinicia a animação
    n.classList.add(cls);
  });
}

function update(quotes) {
  quotes.forEach((q) => {
    document.querySelectorAll(`[data-symbol="${q.symbol}"]`).forEach((root) => {
      root.classList.toggle('stale', q.stale);
      if (!q.hasData) {
        root.dataset.dir = 'flat';
        setText(root, '.px, .price', '—');
        setText(root, '.pct', 'sem dados');
        setText(root, '.chg', '');
        setText(root, '.state', 'Sem dados');
        root.querySelector('polyline')?.setAttribute('points', '');
        return;
      }
      root.dataset.dir = direction(q.changePct);
      root.dataset.open = String(q.marketOpen);
      setText(root, '.px, .price', formatPrice(q.price, q.currency));
      setText(root, '.pct', formatPct(q.changePct));
      setText(root, '.chg', formatChange(q.change, q.currency));
      setText(root, '.state', q.marketOpen ? 'Aberto' : 'Fechado');
      root.querySelector('polyline')?.setAttribute('points', sparkPoints(q.series, SPARK_W, SPARK_H));

      const prev = lastPrice.get(q.symbol);
      if (prev !== undefined && prev !== q.price) {
        flash(root, q.price > prev ? 'flash-up' : 'flash-down');
      }
    });
    if (q.hasData) lastPrice.set(q.symbol, q.price);
  });
}

function fitMarquee() {
  const track = $('track');
  const seconds = track.scrollWidth / 2 / MARQUEE_PX_PER_S;
  track.style.setProperty('--dur', `${Math.max(seconds, 10)}s`);
}

function renderStatus() {
  const s = $('status');
  if (connectionLost) {
    s.textContent = 'Sem ligação ao servidor';
    s.dataset.level = 'error';
  } else if (lastDataAt === null) {
    s.textContent = 'À espera de dados…';
    s.dataset.level = 'warn';
  } else {
    const age = Date.now() - lastDataAt;
    s.textContent = `Atualizado ${ageText(Math.round(age / 1000))}`;
    s.dataset.level = age > STALE_MS ? 'warn' : 'ok';
  }
}

async function refresh() {
  let anyData = false;
  try {
    const res = await fetch('/api/quotes', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { serverTime, sectors, quotes } = await res.json();
    if (!built) {
      build(sectors, quotes);
      built = true;
    }
    update(quotes);
    anyData = quotes.some((q) => q.hasData);
    if (anyData && !marqueeFitted) {
      fitMarquee();
      marqueeFitted = true;
    }
    const newest = Math.max(0, ...quotes.map((q) => q.updatedAt ?? 0));
    lastDataAt = newest ? Date.now() - (serverTime - newest) : null;
    connectionLost = false;
  } catch {
    connectionLost = true;
  }
  renderStatus();
  // Arranque do servidor ainda sem dados: voltar a tentar depressa.
  setTimeout(refresh, anyData || connectionLost ? REFRESH_MS : RETRY_MS);
}

refresh();
setInterval(renderStatus, 1000);
