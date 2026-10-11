// La remise de règlement : solder une dette à un montant rond.
//
// On doit 52 340 : on règle 52 000 (ou 52 500) et la différence est convenue.
// `diff = dû − versé`. Positif, c'est ce qu'on laisse tomber du dû ; négatif,
// c'est ce qu'on a reçu ou versé EN PLUS en arrondissant au-dessus. Dans les deux
// cas le compte de la personne revient à zéro et la caisse n'a bougé que du
// montant réel.
//
// Une remise est une DÉCISION, de quatre sortes :
//   amount  — un montant libre                (on laisse tomber 400)
//   percent — un pourcentage du dû            (5 % de 52 340)
//   round   — l'arrondi du dû                 (52 340 → 52 000 ou 52 500)
//   settle  — solder : la différence entre le dû et ce qu'on règle
// et d'un motif, choisi dans la liste du patron. `resolveRemise` la traduit en
// différence et la borne ; c'est LUI qui fait foi, jamais le pourcentage que
// l'écran a calculé de son côté.
//
// Un arrondi vers le haut est limité au pas de la devise (500 pour le dinar) :
// « arrondir » ne doit pas devenir une façon de faire verser n'importe quoi.
// Une remise vers le bas, elle, peut aller jusqu'au dû — c'est l'accord des deux
// parties, tracé au journal d'audit.
import { Decimal } from './money.js';
import { errors } from './AppError.js';

const DEFAULTS = { defaut: 1, pas: { DZD: 500 } };

// Le pas d'arrondi d'une devise : réglé dans Paramètres, sinon 500 pour le dinar
// et 1 pour le reste.
export async function roundingStep(client, currency) {
  const { rows: [r] } = await client.query("SELECT value FROM app_settings WHERE key = 'arrondi'");
  const v = r?.value ?? {};
  const pas = { ...DEFAULTS.pas, ...(v.pas ?? {}) };
  return new Decimal(pas[currency] ?? v.defaut ?? DEFAULTS.defaut);
}

// `due` et `amount` : Decimal. Renvoie la différence, ou refuse si elle sort du cadre.
export async function remiseDiff(client, { due, amount, currency }) {
  const d = new Decimal(due);
  if (d.lte(0)) throw errors.conflict('Rien à solder : il ne reste rien de dû.');
  const diff = d.minus(amount);
  if (diff.lt(0)) {
    const step = await roundingStep(client, currency);
    if (diff.negated().gt(step)) {
      throw errors.conflict(
        `Arrondi trop large : ${diff.negated().toFixed(2)} ${currency} au-dessus du dû, pour un arrondi permis de ${step.toFixed(2)}.`
      );
    }
  }
  return diff;
}

const KINDS = ['amount', 'percent', 'round', 'settle'];

// Les appelants d'avant disaient `settle: true` : c'est une remise de sorte « solder ».
export function normalizeRemise({ remise, settle } = {}) {
  if (remise) return remise;
  return settle ? { kind: 'settle' } : null;
}

// `due` : ce qui reste dû avant ce versement · `amount` : l'argent réellement versé.
// Rend null s'il n'y a rien à inscrire, sinon { diff, kind, percent, reasonId, note }.
// `diff` > 0 : ce qu'on laisse tomber du dû ; < 0 : un arrondi au-dessus.
export async function resolveRemise(client, { due, amount, currency, spec }) {
  if (!spec) return null;
  if (!KINDS.includes(spec.kind)) throw errors.validation([{ field: 'remise.kind', message: 'Sorte de remise inconnue.' }]);
  const d = new Decimal(due);
  const cash = new Decimal(amount);
  if (d.lte(0)) throw errors.conflict('Rien à solder : il ne reste rien de dû.');

  let diff;
  let percent = null;
  if (spec.kind === 'round' || spec.kind === 'settle') {
    diff = await remiseDiff(client, { due: d, amount: cash, currency });
  } else if (spec.kind === 'amount') {
    const v = new Decimal(String(spec.value ?? '').replace(',', '.') || 'NaN');
    if (!v.isFinite() || v.lte(0)) throw errors.invalidAmount('La remise doit être un montant supérieur à zéro.');
    if (v.decimalPlaces() > 2) throw errors.invalidAmount('Remise : maximum 2 décimales.');
    diff = v;
  } else {
    const p = new Decimal(String(spec.value ?? '').replace(',', '.') || 'NaN');
    if (!p.isFinite() || p.lte(0) || p.gt(100)) throw errors.invalidAmount('Le pourcentage doit être compris entre 0 et 100.');
    percent = p;
    diff = d.times(p).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (diff.lte(0)) throw errors.invalidAmount('Ce pourcentage ne représente aucun montant.');
  }

  // Un montant ou un pourcentage s'ajoutent au versement : ensemble ils ne soldent
  // jamais PLUS que le dû. (Solder et arrondir ont leur propre plafond, plus haut.)
  if ((spec.kind === 'amount' || spec.kind === 'percent') && cash.plus(diff).gt(d)) {
    throw errors.conflict(
      `Le versement (${cash.toFixed(2)}) et la remise (${diff.toFixed(2)}) dépassent le dû de ${d.toFixed(2)} ${currency}.`
    );
  }

  let reasonId = null;
  if (spec.reasonId != null) {
    const { rows: [r] } = await client.query('SELECT active FROM remise_reasons WHERE id = $1', [spec.reasonId]);
    if (!r) throw errors.validation([{ field: 'remise.reasonId', message: 'Motif inconnu.' }]);
    if (!r.active) throw errors.conflict('Ce motif de remise n’est plus utilisé : choisissez-en un autre.');
    reasonId = Number(spec.reasonId);
  }
  if (diff.isZero()) return null;
  return { diff, kind: spec.kind, percent, reasonId, note: spec.note?.trim() || null };
}
