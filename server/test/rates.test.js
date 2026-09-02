import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert } from '../src/lib/rates.js';

test('foreign -> DZD multiplies by rate', () => {
  const r = convert({ fromAmount: '1000', fromRateDzd: '30', toRateDzd: '1', fromCode: 'CNY', toCode: 'DZD' });
  assert.equal(r.dzdValue.toFixed(2), '30000.00');
  assert.equal(r.toAmount.toFixed(2), '30000.00');
});

test('DZD -> foreign divides by rate', () => {
  const r = convert({ fromAmount: '30000', fromRateDzd: '1', toRateDzd: '30', fromCode: 'DZD', toCode: 'CNY' });
  assert.equal(r.toAmount.toFixed(2), '1000.00');
});

test('cross-currency routes through DZD (USD -> EUR)', () => {
  const r = convert({ fromAmount: '100', fromRateDzd: '255', toRateDzd: '270', fromCode: 'USD', toCode: 'EUR' });
  assert.equal(r.dzdValue.toFixed(2), '25500.00');   // 100 * 255
  assert.equal(r.toAmount.toFixed(2), '94.44');       // 25500 / 270
});

test('rejects non-positive rates', () => {
  assert.throws(() => convert({ fromAmount: '1', fromRateDzd: '0', toRateDzd: '1', fromCode: 'X', toCode: 'DZD' }), /taux/);
  assert.throws(() => convert({ fromAmount: '1', fromRateDzd: '1', toRateDzd: '-2', fromCode: 'DZD', toCode: 'Y' }), /taux/);
});
