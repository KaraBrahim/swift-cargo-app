// La vérification avant un paiement ou un encaissement ADOSSÉ À UN BON.
//
// Un bon a son propre reste dû, et le serveur refuse d'aller au-delà : ici, un
// dépassement n'est pas une avance qu'on peut confirmer, c'est une erreur à
// corriger — donc le bouton reste éteint et la phrase dit pourquoi.
//
//   incoming : l'argent ENTRE (fournisseur qui règle) · sinon il SORT (passager payé)
//   due      : ce qui reste dû sur ce bon, avant ce versement
import { useStep } from '../lib/rounding.js';
import { formatMoney } from '../lib/format.js';
import { MoneyConfirm, afterPayment, debtRow } from './MoneyConfirm.jsx';

export function PaymentCheck({ incoming, who, caisse, due, amount, currency, settle, busy, onConfirm, onCancel }) {
  const step = useStep(currency);
  const a = Number(amount) || 0;
  const d = Number(due) || 0;
  const settling = Boolean(settle) && a > 0 && a !== d && a - d <= step;
  const { left, excess } = afterPayment(d, a, settling);
  const cash = Number(caisse?.balances?.[currency] ?? 0);
  const lowFunds = !incoming && Boolean(caisse) && a > cash;

  const warn = [];
  if (excess > 0) warn.push(`${formatMoney(excess, currency)} de plus que le reste dû (${formatMoney(d, currency)}) : corrigez le montant.`);
  if (settling && a !== d) warn.push(`Remise de règlement de ${formatMoney(Math.abs(d - a), currency)} : le bon est soldé, la caisse ne bouge que de ${formatMoney(a, currency)}.`);
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
      warn={warn}
      confirmDisabled={excess > 0 || lowFunds || !caisse}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
