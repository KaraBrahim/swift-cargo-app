// Arrondir un montant libre (dépôt, retrait, charge, transfert) : deux montants
// ronds proposés sous le champ, un clic remplit. Il n'y a aucune dette à solder ici.
//
// La remise d'un règlement — montant, pourcentage, arrondi, solde, avec son motif —
// est un bloc à part : RemiseBlock.
import { useStep, roundChoices } from '../lib/rounding.js';
import { formatNumber } from '../lib/format.js';

const fmt = (v) => formatNumber(v, { decimals: 2, trim: true });

function Chips({ choices, onPick, label }) {
  return (
    <div className="round-chips" role="group" aria-label={label}>
      <span className="muted">{label}</span>
      {choices.map((v) => (
        <button key={v} type="button" className="chip" onClick={() => onPick(v)}>{fmt(v)}</button>
      ))}
    </div>
  );
}

// Un montant libre : propose seulement de l'arrondir.
export function RoundChips({ amount, currency, onPick }) {
  const step = useStep(currency);
  const choices = roundChoices(amount, step);
  if (!choices.length) return null;
  return <Chips choices={choices} label="Arrondir" onPick={(v) => onPick(String(v))} />;
}
