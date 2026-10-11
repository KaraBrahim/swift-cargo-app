// La vérification avant un paiement ou un encaissement ADOSSÉ À UN BON.
//
// Un bon a son propre reste dû, et le serveur refuse d'aller au-delà : ici, un
// dépassement n'est pas une avance qu'on peut confirmer, c'est une erreur à
// corriger — donc le bouton reste éteint et la phrase dit pourquoi.
//
//   incoming : l'argent ENTRE (fournisseur qui règle) · sinon il SORT (passager payé)
//   due      : ce qui reste dû sur ce bon, avant ce versement
//   remise   : l'état du bloc Remise ({ kind, value, reasonId, note })
import { formatMoney } from '../lib/format.js';
import { useRemiseView } from '../lib/useRemise.js';
import { MoneyConfirm, debtRow } from './MoneyConfirm.jsx';

export function PaymentCheck({ incoming, who, caisse, due, amount, currency, remise, busy, onConfirm, onCancel }) {
  const a = Number(amount) || 0;
  const d = Number(due) || 0;
  const { figures, line } = useRemiseView(remise, d, a, currency);
  const cash = Number(caisse?.balances?.[currency] ?? 0);
  const lowFunds = !incoming && Boolean(caisse) && a > cash;
  // Plus que le dû, et sans remise qui l'explique : une erreur à corriger.
  const excess = figures.error ? 0 : figures.excess;
  const left = figures.left;

  const warn = [];
  if (excess > 0) warn.push(`${formatMoney(excess, currency)} de plus que le reste dû (${formatMoney(d, currency)}) : corrigez le montant.`);
  if (figures.error) warn.push(figures.error);
  if (lowFunds) warn.push(`La caisse ne contient que ${formatMoney(cash, currency)} : le paiement sera refusé.`);

  return (
    <MoneyConfirm
      open
      kind={incoming ? 'in' : 'out'}
      title={incoming ? `Encaisser de ${who}` : `Payer ${who}`}
      amount={a} currency={currency}
      rows={caisse ? [
        { label: `Caisse « ${caisse.label} »`, before: cash, after: incoming ? cash + a : cash - a, currency, tone: 'caisse' },
        debtRow({ who, out: !incoming, before: d, after: left, currency }),
      ] : []}
      remise={line}
      warn={warn}
      confirmDisabled={excess > 0 || Boolean(figures.error) || lowFunds || !caisse}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
