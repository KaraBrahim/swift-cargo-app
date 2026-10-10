// La remise de règlement : solder une dette à un montant rond.
//
// On doit 52 340 : on règle 52 000 (ou 52 500) et la différence est convenue.
// `diff = dû − versé`. Positif, c'est ce qu'on laisse tomber du dû ; négatif,
// c'est ce qu'on a reçu ou versé EN PLUS en arrondissant au-dessus. Dans les deux
// cas le compte de la personne revient à zéro et la caisse n'a bougé que du
// montant réel.
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
