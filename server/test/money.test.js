import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, roundTo, money, Decimal } from '../src/lib/money.js';

test('parseAmount accepts valid positive decimals', () => {
  assert.equal(parseAmount('1000.50', 2).toFixed(2), '1000.50');
  assert.equal(parseAmount(250, 2).toFixed(2), '250.00');
});

test('parseAmount rejects zero, negative, and too many decimals', () => {
  assert.throws(() => parseAmount('0', 2), /strictement positif/);
  assert.throws(() => parseAmount('-5', 2), /strictement positif/);
  assert.throws(() => parseAmount('1.999', 2), /2 décimales/);
});

test('parseAmount rejects non-numeric and non-finite', () => {
  assert.throws(() => parseAmount('abc', 2), /format numérique/);
  assert.throws(() => parseAmount('', 2), /manquante/);
  assert.throws(() => parseAmount('Infinity', 2), /non finie|format/);
});

test('parseAmount rejects absurdly large values', () => {
  assert.throws(() => parseAmount('99999999999999', 2), /trop élevée/);
});

test('roundTo uses HALF_UP', () => {
  assert.equal(roundTo(new Decimal('2.005'), 2).toFixed(2), '2.01');
  assert.equal(roundTo(new Decimal('2.004'), 2).toFixed(2), '2.00');
});

test('money formats at fixed scale', () => {
  assert.equal(money(new Decimal('10'), 2), '10.00');
  assert.equal(money(new Decimal('10.1'), 2), '10.10');
});
