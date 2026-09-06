// Black-market conversion, DZD-pivot.
// A rate is "how many DZD for 1 whole unit of this currency". DZD itself = 1.
// Cross-currency (e.g. CNY -> USD) always routes through DZD:
//     dzdValue = fromAmount * fromRateDzd     (rounded to DZD scale)
//     toAmount = dzdValue / toRateDzd         (rounded to target scale)
import { Decimal, roundTo } from './money.js';
import { errors } from './AppError.js';

const DZD_SCALE = 2;

// `directRate` is the price quoted for this pair, when there is one: how many
// `to` units per 1 `from` unit. The USD/CNY black-market price is its own price
// and not the quotient of two dinar rates, so when it is set it wins.
//
// The dinar value still comes from the SOURCE leg — that is what the money
// leaving the till is worth in dinars, and it is what the reports total. The
// returned `toRateDzd` is then the rate this trade IMPLIES for the target
// currency, which keeps the stored row internally consistent
// (to_amount = dzd_value / to_rate_dzd) while showing honestly that the trade
// did not go at the board rate.
export function convert({ fromAmount, fromRateDzd, toRateDzd, fromCode, toCode, toScale = 2, directRate = null }) {
  const fa = new Decimal(fromAmount);
  const fr = new Decimal(fromRateDzd);
  const tr = new Decimal(toRateDzd);

  if (!fr.isFinite() || fr.lte(0)) throw errors.noRate(fromCode);
  if (!tr.isFinite() || tr.lte(0)) throw errors.noRate(toCode);

  const dzdValue = roundTo(fa.mul(fr), DZD_SCALE);

  const direct = directRate == null ? null : new Decimal(directRate);
  if (direct && (!direct.isFinite() || direct.lte(0))) throw errors.noRate(toCode);

  const toAmount = direct ? roundTo(fa.mul(direct), toScale) : roundTo(dzdValue.div(tr), toScale);

  // Effective rate is informational (how many `to` units per 1 `from` unit).
  const effectiveRate = fa.gt(0) ? roundTo(toAmount.div(fa), 8) : new Decimal(0);
  const impliedToRateDzd = toAmount.gt(0) ? roundTo(dzdValue.div(toAmount), 8) : tr;

  return { dzdValue, toAmount, effectiveRate, toRateDzd: direct ? impliedToRateDzd : tr };
}
