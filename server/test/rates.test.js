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

// A quoted pair is the price this house trades at: it overrides the dinar
// detour, and the row it produces must still add up.
test('a direct pair rate overrides the DZD route', () => {
  const viaDzd = convert({ fromAmount: '100', fromRateDzd: '255', toRateDzd: '30', fromCode: 'USD', toCode: 'CNY' });
  assert.equal(viaDzd.toAmount.toFixed(2), '850.00');        // 25500 / 30

  const direct = convert({
    fromAmount: '100', fromRateDzd: '255', toRateDzd: '30',
    fromCode: 'USD', toCode: 'CNY', directRate: '8.20',
  });
  assert.equal(direct.toAmount.toFixed(2), '820.00');        // 100 * 8.20
  assert.equal(direct.effectiveRate.toFixed(2), '8.20');
  // The source is still worth what it is worth in dinars...
  assert.equal(direct.dzdValue.toFixed(2), '25500.00');
  // ...and the stored target rate is the one this trade implies, so the row
  // keeps to_amount = dzd_value / to_rate_dzd instead of quietly lying.
  assert.equal(direct.toRateDzd.toFixed(4), '31.0976');      // 25500 / 820
  assert.equal(
    direct.dzdValue.div(direct.toRateDzd).toFixed(2),
    direct.toAmount.toFixed(2)
  );
});

test('a zero or negative pair rate is refused like a missing rate', () => {
  for (const bad of ['0', '-3']) {
    assert.throws(
      () => convert({ fromAmount: '10', fromRateDzd: '255', toRateDzd: '30', fromCode: 'USD', toCode: 'CNY', directRate: bad }),
      (e) => e.code === 'NO_RATE'
    );
  }
});
