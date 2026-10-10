// Arrondir un règlement, et solder la dette avec la différence.
//
// On doit 52 340 : on propose 52 000 et 52 500. Un clic remplit le montant ET
// décide de solder — le compte de la personne tombe à zéro, la différence
// s'inscrit en « remise de règlement », et la caisse ne bouge que du montant réel.
// Tout reste modifiable à la main : le montant se retape, la case se décoche
// (le versement redevient un simple acompte).
//
//   RemiseControl : pour un règlement qui a un DÛ (bon, compte, salaire).
//   RoundChips    : pour un montant libre (dépôt, retrait, charge) — il propose
//                   seulement de l'arrondir, il n'y a aucune dette à solder.
import { useStep, roundChoices } from '../lib/rounding.js';
import { formatMoney, formatNumber } from '../lib/format.js';

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

// due : ce qui reste dû (nombre) · amount : ce qu'on règle (texte du champ)
// settle / onSettle : « solder avec la différence »
export function RemiseControl({ due, amount, currency, onAmount, settle, onSettle }) {
  const step = useStep(currency);
  const d = Number(due);
  const a = Number(amount);
  if (!(d > 0)) return null;

  const choices = roundChoices(d, step);
  const diff = Math.round((d - a) * 100) / 100; // > 0 : on laisse tomber · < 0 : on arrondit au-dessus
  const differs = a > 0 && diff !== 0;
  const tooHigh = diff < 0 && -diff > step; // au-dessus du dû, le serveur borne à un pas

  return (
    <div className="remise">
      {choices.length > 0 && (
        <Chips
          choices={choices}
          label={`Arrondir le dû de ${fmt(d)}`}
          onPick={(v) => { onAmount(String(v)); onSettle(true); }}
        />
      )}
      {differs && (
        <label className={`remise-line ${settle ? 'on' : ''}`}>
          <input type="checkbox" checked={Boolean(settle)} disabled={tooHigh} onChange={(e) => onSettle(e.target.checked)} />
          <span>
            {diff > 0
              ? <>Solder : laisser tomber <strong>{formatMoney(diff, currency)}</strong> en remise</>
              : <>Solder en arrondissant au-dessus : <strong>{formatMoney(-diff, currency)}</strong> de plus que le dû</>}
            {tooHigh && <em className="neg"> — au-delà de l’arrondi permis ({fmt(step)})</em>}
          </span>
        </label>
      )}
      {differs && settle && !tooHigh && (
        <p className="remise-sum muted">
          Le compte sera soldé. Remise de règlement : {formatMoney(diff, currency)} — la caisse ne bouge que de {formatMoney(a, currency)}.
        </p>
      )}
      {differs && !settle && diff > 0 && (
        <p className="remise-sum muted">Sans solder, il restera {formatMoney(diff, currency)} à régler : c’est un acompte.</p>
      )}
    </div>
  );
}
