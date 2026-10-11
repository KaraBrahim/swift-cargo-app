// Régler une dette sans quitter la liste des dettes.
//
// Avant, « Payer » / « Encaisser » ouvrait la fiche de la personne, où il fallait
// retrouver le formulaire, choisir la caisse, retaper le montant. Ici tout est
// pré-rempli — la dette entière, la seule caisse possible — et il reste deux
// gestes : vérifier, confirmer. Le second écran montre les soldes AVANT → APRÈS.
//
// Les garde-fous sont ceux du serveur, dits d'avance :
//   • une caisse qui ne contient pas la somme n'est pas choisissable pour payer ;
//   • un montant au-dessus de la dette demande une case cochée (c'est une avance) ;
//   • un fournisseur ne paie qu'en Algérie.
import { useState } from 'react';
import { api } from '../api/client.js';
import { useIdempotent } from '../lib/useIdempotent.js';
import { useStep } from '../lib/rounding.js';
import { formatMoney } from '../lib/format.js';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { MoneyConfirm, afterPayment, debtRow } from './MoneyConfirm.jsx';
import { RemiseControl } from './RemiseControl.jsx';
import AmountInput from './AmountInput.jsx';
import { errorMessage, useToast } from './ui.jsx';

const OFFICE = { china: 'Bureau Chine', algeria: 'Bureau Algérie' };

export function QuickSettle({ debt, caisses, onClose, onDone }) {
  const toast = useToast();
  const idem = useIdempotent();
  const cur = debt.currency_code;
  const step = useStep(cur);
  const incoming = Number(debt.balance) < 0; // ils nous doivent : l'argent ENTRE
  const out = !incoming;
  const due = Math.abs(Number(debt.balance));

  // Un fournisseur qui règle sa dette paie au bureau d'Algérie, et seulement là.
  const candidates = caisses.filter((c) => c.kind === 'office'
    && !(incoming && debt.is_fournisseur && c.office !== 'algeria'));
  const [caisseId, setCaisseId] = useState(candidates.length === 1 ? String(candidates[0].id) : '');
  const [amount, setAmount] = useState(due.toFixed(2));
  const [settle, setSettle] = useState(false);
  const [excessOk, setExcessOk] = useState(false);
  const [note, setNote] = useState('');
  const [stage, setStage] = useState('form'); // 'form' | 'check'
  const [busy, setBusy] = useState(false);

  const a = Number(amount) || 0;
  const caisse = candidates.find((c) => String(c.id) === caisseId);
  const cash = Number(caisse?.balances?.[cur] ?? 0);
  // « Solder » n'a de sens que dans la limite d'un pas d'arrondi au-dessus du dû.
  const settling = settle && a > 0 && a !== due && a - due <= step;
  const { left, excess } = afterPayment(due, a, settling);
  const lowFunds = out && Boolean(caisse) && a > cash;
  const ready = Boolean(caisse) && a > 0 && !lowFunds && (excess === 0 || excessOk);

  const rows = caisse ? [
    {
      label: `Caisse « ${caisse.label} »`, before: cash, after: out ? cash - a : cash + a,
      currency: cur, tone: 'caisse',
    },
    debtRow({
      who: debt.person_name, out, before: due,
      after: excess > 0 ? excess : left, currency: cur,
    }),
  ] : [];
  const warn = [];
  if (excess > 0) warn.push(`${formatMoney(excess, cur)} de plus que la dette : le compte de ${debt.person_name} sera retourné (c’est ${out ? 'lui' : 'vous'} qui devrez ensuite).`);
  if (settling && a !== due) warn.push(`Remise de règlement de ${formatMoney(Math.abs(due - a), cur)} : le compte tombe à zéro, la caisse ne bouge que de ${formatMoney(a, cur)}.`);

  const submit = async () => {
    setBusy(true);
    try {
      await idem((key) => api(`/people/${debt.person_id}/payment`, {
        method: 'POST', idem: key,
        body: {
          caisseId: Number(caisseId), amount: String(amount), currency: cur,
          direction: incoming ? 'in' : 'out', note: note || undefined,
          settle: settling || undefined, allowExcess: excess > 0 || undefined,
        },
      }));
      const rest = excess > 0 ? 0 : left;
      toast.success(`${incoming ? 'Encaissement' : 'Paiement'} enregistré. ${rest > 0
        ? `Il reste ${formatMoney(rest, cur)} ${incoming ? 'à encaisser' : 'à payer'} : la dette reste ouverte.`
        : 'Dette soldée.'}`);
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
      setStage('form');
    } finally { setBusy(false); }
  };

  if (stage === 'check') {
    return (
      <MoneyConfirm
        open
        kind={incoming ? 'in' : 'out'}
        title={incoming ? `Encaisser de ${debt.person_name}` : `Payer ${debt.person_name}`}
        amount={a} currency={cur} rows={rows} warn={warn}
        busy={busy} onConfirm={submit} onCancel={() => setStage('form')}
      />
    );
  }

  return (
    <ConfirmDialog
      open
      tone="warn"
      icon={incoming ? 'arrowIn' : 'arrowOut'}
      wide
      title={incoming ? `Encaisser de ${debt.person_name}` : `Payer ${debt.person_name}`}
      confirmLabel="Vérifier"
      cancelLabel="Fermer"
      confirmDisabled={!ready}
      onConfirm={() => setStage('check')}
      onCancel={onClose}
    >
      <div className="qs">
        <div className={`qs-due ${out ? 'out' : 'in'}`}>
          <span className="mc-dir">{out ? 'Vous devez' : 'On vous doit'}</span>
          <strong>{formatMoney(due, cur)}</strong>
        </div>

        <div className="field">
          <span>{incoming ? 'Caisse qui reçoit' : 'Caisse qui paie'}</span>
          <div className="qs-caisses">
            {candidates.map((c) => {
              const bal = Number(c.balances?.[cur] ?? 0);
              const low = out && bal < a;
              return (
                <button key={c.id} type="button" aria-pressed={String(c.id) === caisseId}
                  className={`qs-caisse ${low ? 'low' : ''}`} onClick={() => setCaisseId(String(c.id))}>
                  <span>{c.label} <small>· {OFFICE[c.office] || c.kind}</small></span>
                  <small>{formatMoney(bal, cur)} en caisse{low ? ' — insuffisant' : ''}</small>
                </button>
              );
            })}
            {!candidates.length && <p className="muted">Aucune caisse possible{incoming && debt.is_fournisseur ? ' : un fournisseur paie en Algérie' : ''}.</p>}
          </div>
        </div>

        <label className="field">
          <span>Montant ({cur})</span>
          <AmountInput autoFocus value={amount} onChange={(v) => { setAmount(v); setExcessOk(false); }} />
          <button type="button" className="btn btn-ghost btn-sm qs-full" onClick={() => { setAmount(due.toFixed(2)); setSettle(false); }}>
            Tout régler : {formatMoney(due, cur)}
          </button>
        </label>

        <RemiseControl due={due} amount={amount} currency={cur} onAmount={setAmount} settle={settle} onSettle={setSettle} />

        {excess > 0 && (
          <label className="remise-line on">
            <input type="checkbox" checked={excessOk} onChange={(e) => setExcessOk(e.target.checked)} />
            <span>Ce montant dépasse la dette de <strong>{formatMoney(excess, cur)}</strong> — je le veux (avance).</span>
          </label>
        )}
        {lowFunds && <p className="mc-warn" role="alert">La caisse ne contient que {formatMoney(cash, cur)} : choisissez une autre caisse ou baissez le montant.</p>}

        <label className="field">
          <span>Note (optionnel)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="acompte, règlement partiel…" />
        </label>

        {a > 0 && !excess && left > 0 && (
          <p className="muted">Il restera <strong className={out ? 'debt-out' : 'debt-in'}>{formatMoney(left, cur)}</strong> {out ? 'à payer' : 'à encaisser'} : la dette reste ouverte.</p>
        )}
      </div>
    </ConfirmDialog>
  );
}
