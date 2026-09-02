// All money math goes through here. Amounts are NEVER floats: they arrive as
// strings, are parsed with decimal.js, and are stored in Postgres NUMERIC.
// This is the single most important file for an "error-free caisse".
import Decimal from 'decimal.js';
import { errors } from './AppError.js';

Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

// Hard cap to reject absurd / overflow values (10 trillion base units).
export const MAX_AMOUNT = new Decimal('1e13');

// Parse an untrusted value into a Decimal, rejecting anything non-finite.
export function toDecimal(v, field = 'montant') {
  if (v instanceof Decimal) return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw errors.invalidAmount(`${field} : nombre invalide.`);
    v = String(v);
  }
  if (typeof v !== 'string' || v.trim() === '') {
    throw errors.invalidAmount(`${field} : valeur manquante ou invalide.`);
  }
  let d;
  try {
    d = new Decimal(v.trim());
  } catch {
    throw errors.invalidAmount(`${field} : format numérique invalide.`);
  }
  if (!d.isFinite()) throw errors.invalidAmount(`${field} : valeur non finie.`);
  return d;
}

// A valid POSITIVE amount at a given currency scale (decimal places).
export function parseAmount(v, scale, field = 'montant') {
  const d = toDecimal(v, field);
  if (d.lte(0)) throw errors.invalidAmount(`${field} : doit être strictement positif.`);
  if (d.gt(MAX_AMOUNT)) throw errors.invalidAmount(`${field} : valeur trop élevée.`);
  if (d.decimalPlaces() > scale) {
    throw errors.invalidAmount(`${field} : maximum ${scale} décimales pour cette devise.`);
  }
  return d;
}

export function roundTo(d, scale) {
  return new Decimal(d).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
}

// Fixed-scale string for DB storage / API output (e.g. "1000.50").
export function money(d, scale) {
  return roundTo(d, scale).toFixed(scale);
}

export const gte = (a, b) => new Decimal(a).gte(b);
export const add = (a, b) => new Decimal(a).plus(b);
export const sub = (a, b) => new Decimal(a).minus(b);
