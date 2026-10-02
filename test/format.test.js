import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPrice, formatPct, formatChange, direction, ageText, sparkPoints, stateText,
} from '../public/format.js';

// Intl usa espaços não separáveis; normalizamos para comparar.
const norm = (s) => s.replace(/\s/g, ' ');

test('formatPrice usa símbolo e casas decimais da moeda', () => {
  assert.equal(norm(formatPrice(150.65, 'USD')), '$150,65');
  assert.equal(norm(formatPrice(1833000, 'KRW')), '₩1 833 000');
  assert.equal(norm(formatPrice(12, 'CHF')), 'CHF 12,00');
});

test('formatPct mostra sinal e duas casas', () => {
  assert.equal(formatPct(1.236), '+1,24%');
  assert.equal(formatPct(-0.5), '-0,50%');
  assert.equal(formatPct(0), '0,00%');
});

test('formatPct não mostra -0,00% para variação minúscula negativa', () => {
  assert.equal(formatPct(-0.001), '0,00%');
  assert.equal(formatPct(0.004), '0,00%');
});

test('formatChange mostra sinal e moeda', () => {
  assert.equal(norm(formatChange(0.21, 'USD')), '+$0,21');
  assert.equal(norm(formatChange(-20000, 'KRW')), '-₩20 000');
  assert.equal(norm(formatChange(0, 'USD')), '$0,00');
});

test('direction usa o valor arredondado', () => {
  assert.equal(direction(1.2), 'up');
  assert.equal(direction(-0.5), 'down');
  assert.equal(direction(-0.001), 'flat');
  assert.equal(direction(0), 'flat');
});

test('ageText', () => {
  assert.equal(ageText(5), 'há 5 s');
  assert.equal(ageText(59), 'há 59 s');
  assert.equal(ageText(60), 'há 1 min');
  assert.equal(ageText(150), 'há 2 min');
  assert.equal(ageText(-3), 'há 0 s');
});

test('sparkPoints mapeia a série para coordenadas SVG', () => {
  assert.equal(sparkPoints([1, 2, 3], 100, 20), '0.0,18.0 50.0,10.0 100.0,2.0');
});

test('sparkPoints: série igual dá linha a meio; 0 ou 1 ponto dá vazio', () => {
  assert.equal(sparkPoints([5, 5, 5], 100, 20), '0.0,10.0 50.0,10.0 100.0,10.0');
  assert.equal(sparkPoints([5], 100, 20), '');
  assert.equal(sparkPoints([], 100, 20), '');
});

test('stateText: desatualizado mostra há quanto tempo, em vez de Aberto', () => {
  const now = 1_000_000;
  const stale = { hasData: true, stale: true, marketOpen: true, updatedAt: now - 180_000 };
  assert.equal(stateText(stale, now), 'Desatualizado há 3 min');
});

test('stateText: sem dados, aberto e fechado', () => {
  const now = 1_000_000;
  assert.equal(stateText({ hasData: false, stale: false }, now), 'Sem dados');
  assert.equal(stateText({ hasData: true, stale: false, marketOpen: true, updatedAt: now }, now), 'Aberto');
  assert.equal(stateText({ hasData: true, stale: false, marketOpen: false, updatedAt: now }, now), 'Fechado');
});
