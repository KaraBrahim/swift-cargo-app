// Black-market conversion, DZD-pivot.
// A rate is "how many DZD for 1 whole unit of this currency". DZD itself = 1.
// Cross-currency (e.g. CNY -> USD) always routes through DZD:
//     dzdValue = fromAmount * fromRateDzd     (rounded to DZD scale)
//     toAmount = dzdValue / toRateDzd         (rounded to target scale)
import { Decimal, roundTo } from './money.js';
import { errors } from './AppError.js';

const DZD_SCALE = 2;

export function convert({ fromAmount, fromRateDzd, toRateDzd, fromCode, toCode, toScale = 2 }) {
  const fa = new Decimal(fromAmount);
  const fr = new Decimal(fromRateDzd);
  const tr = new Decimal(toRateDzd);

  if (!fr.isFinite() || fr.lte(0)) throw errors.noRate(fromCode);
  if (!tr.isFinite() || tr.lte(0)) throw errors.noRate(toCode);

  const dzdValue = roundTo(fa.mul(fr), DZD_SCALE);
  const toAmount = roundTo(dzdValue.div(tr), toScale);

  // Effective rate is informational (how many `to` units per 1 `from` unit).
  const effectiveRate = fa.gt(0) ? roundTo(toAmount.div(fa), 8) : new Decimal(0);

  return { dzdValue, toAmount, effectiveRate };
}
