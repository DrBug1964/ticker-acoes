import {
  formatPrice, formatPct, formatChange, direction, sparkPoints, stateText,
} from './format.js';

const MARQUEE_PX_PER_S = 60;
const SPARK_W = 120;
const SPARK_H = 32;
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

let signature = '';
let marqueeFitted = false;
const lastPrice = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildTick(q, group) {
  const item = el('span', 'tick');
  item.dataset.symbol = q.symbol;
  item.style.setProperty('--accent', group.color);
  item.append(
    el('span', 'badge', group.market.toUpperCase()),
    el('span', 'sym', q.symbol),
    el('span', 'px', '—'),
    el('span', 'pct', ''),
  );
  return item;
}

function buildCard(q, onRemove) {
  const card = el('article', 'card');
  card.dataset.symbol = q.symbol;
  const head = el('div', 'card-head');
  head.append(el('span', 'name', q.name), el('span', 'sym', q.symbol));
  const remove = el('button', 'remove', '✕');
  remove.type = 'button';
  remove.title = `Retirar ${q.name}`;
  remove.setAttribute('aria-label', `Retirar ${q.name}`);
  remove.addEventListener('click', () => onRemove(q.symbol));
  const row = el('div', 'row');
  row.append(el('span', 'pct', ''), el('span', 'chg', ''));
  const foot = el('div', 'foot');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', `0 0 ${SPARK_W} ${SPARK_H}`);
  svg.append(document.createElementNS(SVG_NS, 'polyline'));
  foot.append(el('span', 'state', ''), svg);
  card.append(head, remove, el('div', 'price', '—'), row, foot);
  return card;
}

function build(groups, onRemove) {
  const track = $('track');
  track.replaceChildren();
  for (let copy = 0; copy < 2; copy += 1) {
    const g = el('div', 'marquee-group');
    if (copy === 1) g.setAttribute('aria-hidden', 'true');
    groups.forEach((group) => group.quotes.forEach((q) => g.append(buildTick(q, group))));
    track.append(g);
  }
  const grid = $('grid');
  grid.replaceChildren();
  groups.forEach((group) => {
    const section = el('section', 'sector');
    section.style.setProperty('--accent', group.color);
    section.append(el('h2', '', group.label));
    const cards = el('div', 'cards');
    group.quotes.forEach((q) => cards.append(buildCard(q, onRemove)));
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

function update(quotes, serverTime) {
  quotes.forEach((q) => {
    document.querySelectorAll(`[data-symbol="${CSS.escape(q.symbol)}"]`).forEach((root) => {
      root.classList.toggle('stale', q.stale);
      setText(root, '.state', stateText(q, serverTime));
      if (!q.hasData) {
        root.dataset.dir = 'flat';
        root.dataset.open = 'false';
        setText(root, '.px, .price', '—');
        setText(root, '.pct', 'sem dados');
        setText(root, '.chg', '');
        root.querySelector('polyline')?.setAttribute('points', '');
        return;
      }
      root.dataset.dir = direction(q.changePct);
      root.dataset.open = String(q.marketOpen && !q.stale);
      setText(root, '.px, .price', formatPrice(q.price, q.currency));
      setText(root, '.pct', formatPct(q.changePct));
      setText(root, '.chg', formatChange(q.change, q.currency));
      root.querySelector('polyline')?.setAttribute('points', sparkPoints(q.series, SPARK_W, SPARK_H));

      const prev = lastPrice.get(q.symbol);
      if (prev !== undefined && prev !== q.price) flash(root, q.price > prev ? 'flash-up' : 'flash-down');
    });
    if (q.hasData) lastPrice.set(q.symbol, q.price);
  });
}

// Repete o conteúdo da faixa até cobrir a largura da janela; a animação percorre metade da faixa.
function fitMarquee() {
  const track = $('track');
  const groupWidth = track.firstElementChild?.getBoundingClientRect().width ?? 0;
  if (!groupWidth) return;
  const half = Math.max(1, Math.ceil(window.innerWidth / groupWidth));
  while (track.children.length < half * 2) {
    const clone = track.firstElementChild.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    track.append(clone);
  }
  track.style.setProperty('--dur', `${Math.max((groupWidth * half) / MARQUEE_PX_PER_S, 10)}s`);
}

export function render(payload, { onRemove }) {
  const quotes = payload.groups.flatMap((g) => g.quotes);
  const hasItems = quotes.length > 0;
  $('empty').hidden = hasItems;
  $('marquee').hidden = !hasItems;

  const sig = payload.groups.map((g) => `${g.market}:${g.quotes.map((q) => q.symbol).join(',')}`).join('|');
  if (sig !== signature) {
    build(payload.groups, onRemove);
    signature = sig;
    marqueeFitted = false;
  }
  update(quotes, payload.serverTime);

  const anyData = quotes.some((q) => q.hasData);
  if (hasItems && anyData && !marqueeFitted) {
    fitMarquee();
    marqueeFitted = true;
  }
  return { hasItems, pending: quotes.some((q) => !q.hasData && !q.error) };
}
