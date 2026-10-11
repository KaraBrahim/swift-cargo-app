// Avant que l'argent bouge : ce qui va se passer, en chiffres, et un seul bouton
// qui dit exactement quoi — « Payer 47 500 DZD ».
//
// Un geste d'argent ne se rattrape pas d'un clic (annuler un paiement demande un
// super-administrateur). Alors, juste avant, on montre :
//   • le sens et le montant, en grand ;
//   • chaque solde touché, AVANT → APRÈS : la caisse, la dette de la personne ;
//   • ce qui cloche (caisse qui passerait en négatif, dépassement de la dette).
// Rien n'est enregistré tant qu'on n'a pas confirmé, et on peut encore annuler.
//
//   kind  : 'in' (entrée de caisse) · 'out' (sortie) · 'move' (autre geste)
//   rows  : [{ label, before, after, currency, tone }]
//           tone : 'debt-out' (rouge) · 'debt-in' (or) · 'caisse' (neutre)
//   warn  : [texte] — en rouge, au-dessus du bouton
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { formatMoney } from '../lib/format.js';

const KIND_TEXT = { in: 'Entrée de caisse', out: 'Sortie de caisse', move: 'Mouvement' };

// Ce qui reste dû après un règlement : tout si on solde, sinon le reste.
// `excess` : ce qui dépasse la dette — et qui retournerait le compte dans l'autre sens.
export function afterPayment(due, amount, settle = false) {
  const d = Math.max(Number(due) || 0, 0);
  const a = Number(amount) || 0;
  return {
    left: settle ? 0 : Math.max(Math.round((d - a) * 100) / 100, 0),
    excess: settle ? 0 : Math.max(Math.round((a - d) * 100) / 100, 0),
  };
}

// La ligne « dette » d'un règlement, toute prête.
export function debtRow({ who, out, before, after, currency }) {
  return {
    label: out ? `Vous devez à ${who}` : `${who} vous doit`,
    before: Number(before), after: Number(after), currency,
    tone: out ? 'debt-out' : 'debt-in',
    settledWord: 'Soldé',
  };
}

function Flow({ row }) {
  const done = row.tone?.startsWith('debt') && Number(row.after) === 0;
  return (
    <span className="mc-flow">
      <s>{formatMoney(row.before, row.currency)}</s>
      <span aria-hidden="true">→</span>
      <b className={done ? 'mc-ok' : ''}>{done ? row.settledWord || 'Soldé' : formatMoney(row.after, row.currency)}</b>
    </span>
  );
}

export function MoneyConfirm({
  open, kind = 'move', title, amount, currency, rows = [], remise, warn = [], note,
  confirmLabel, busy, confirmDisabled, onConfirm, onCancel, children,
}) {
  const label = confirmLabel
    || (kind === 'in' ? `Encaisser ${formatMoney(amount, currency)}`
      : kind === 'out' ? `Payer ${formatMoney(amount, currency)}`
        : 'Confirmer');
  return (
    <ConfirmDialog
      open={open}
      tone="warn"
      icon="coins"
      wide
      title={title || 'Vérifiez avant de confirmer'}
      confirmLabel={label}
      cancelLabel="Corriger"
      busy={busy}
      confirmDisabled={confirmDisabled}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="mc">
        {amount != null && (
          <div className={`mc-amount ${kind}`}>
            <span className="mc-dir">{KIND_TEXT[kind]}</span>
            <strong>{formatMoney(amount, currency)}</strong>
          </div>
        )}
        {rows.length > 0 && (
          <div className="mc-rows">
            {rows.map((r) => (
              <div key={r.label} className={`mc-row ${r.tone || ''}`}>
                <span>{r.label}</span>
                <Flow row={r} />
              </div>
            ))}
          </div>
        )}
        {remise && (
          <div className="mc-remise">
            <span>Remise<small>{remise.text}</small></span>
            <b>{formatMoney(remise.amount, currency)}</b>
          </div>
        )}
        {children}
        {warn.map((w) => <p key={w} className="mc-warn" role="alert">{w}</p>)}
        <p className="mc-note">{note || 'Rien n’est enregistré avant « Confirmer ». Vous pouvez encore corriger.'}</p>
      </div>
    </ConfirmDialog>
  );
}
