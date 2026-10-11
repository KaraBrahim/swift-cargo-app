// La remise, au comptoir : un seul bloc, le même partout où l'on règle une dette
// (fiche de la personne, bon, ordre, salaire, règlement direct).
//
//   Aucune · Total · Montant · % · Arrondir
//
// « Total » est l'option principale : on tape ce que la personne règle au total
// et la remise en découle (dû − total), le compte étant soldé. On ne calcule pas
// la remise, on dit seulement le prix final.
//
// Choisir une sorte suffit : le versement se recalcule tout seul (dû − remise),
// et une ligne dit en chiffres « Dû 52 340 − remise 2 617 (5 %) = à verser
// 49 723 ». On peut toujours retaper le versement à la main — la remise reste, et
// ce qui n'est pas couvert reste dû. Le motif se choisit dans la liste du patron
// (facultatif) et s'accompagne d'une note libre.
import { useApi } from '../api/useApi.js';
import { useStep, roundChoices } from '../lib/rounding.js';
import { NO_REMISE, remiseFigures } from '../lib/remise.js';
import { formatMoney, formatNumber } from '../lib/format.js';
import AmountInput from './AmountInput.jsx';

const KINDS = [
  ['none', 'Aucune'],
  ['settle', 'Total'],
  ['amount', 'Remise en montant'],
  ['percent', 'Remise en %'],
  ['round', 'Arrondir'],
];
const PERCENT_CHIPS = [5, 10, 15, 20];
const fmt = (v) => formatNumber(v, { decimals: 2, trim: true });

// due : ce qui reste dû (nombre) · amount : le versement (texte du champ)
// value / onChange : l'état de la remise ({ kind, value, reasonId, note })
// onAmount : change le versement
export function RemiseBlock({ due, amount, currency, onAmount, value: rm = NO_REMISE, onChange }) {
  const step = useStep(currency);
  const reasons = useApi('/remises/reasons');
  const d = Number(due);
  const figures = remiseFigures(rm, d, amount, step);
  if (!(d > 0)) return null;

  const dueText = d.toFixed(2);
  const setKind = (kind) => {
    if (kind === 'none') { onChange(NO_REMISE); onAmount(dueText); return; }
    // Changer de sorte repart d'un versement complet : c'est la remise qui le diminue.
    onChange({ ...rm, kind, value: '' });
    if (kind === 'round') {
      const [down] = roundChoices(d, step);
      onAmount(down != null ? String(down) : dueText);
    } else if (kind === 'amount' || kind === 'percent') {
      onAmount(dueText);
    }
  };

  // Un montant ou un pourcentage tapé met le versement à (dû − remise).
  const setValue = (v) => {
    onChange({ ...rm, value: v });
    const n = Number(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
    const diff = rm.kind === 'percent' ? Math.round(d * n) / 100 : n;
    onAmount(Math.max(Math.round((d - diff) * 100) / 100, 0).toFixed(2));
  };

  const choices = rm.kind === 'round' ? roundChoices(d, step) : [];
  const list = reasons.data?.reasons ?? [];

  return (
    <div className={`rb ${rm.kind !== 'none' ? 'on' : ''}`}>
      <div className="rb-head">
        <span className="rb-title">Remise</span>
        <div className="seg" role="group" aria-label="Sorte de remise">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" className={`${rm.kind === k ? 'active' : ''} ${k === 'settle' ? 'rb-main' : ''}`} aria-pressed={rm.kind === k} onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>
      </div>

      {rm.kind === 'amount' && (
        <label className="rb-row">
          <span>Montant de la remise</span>
          <AmountInput value={rm.value} onChange={setValue} />
        </label>
      )}

      {rm.kind === 'percent' && (
        <div className="rb-row">
          <label className="rb-pct">
            <span>Pourcentage du dû</span>
            <span className="rb-pct-in">
              <input inputMode="decimal" value={rm.value} placeholder="0" onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))} />
              <b>%</b>
            </span>
          </label>
          <div className="round-chips" role="group" aria-label="Pourcentages courants">
            {PERCENT_CHIPS.map((p) => (
              <button key={p} type="button" className={`chip ${Number(rm.value) === p ? 'active' : ''}`} onClick={() => setValue(String(p))}>{p} %</button>
            ))}
          </div>
        </div>
      )}

      {rm.kind === 'round' && (
        <div className="rb-row">
          {choices.length > 0 ? (
            <div className="round-chips" role="group" aria-label="Arrondir le dû">
              <span className="muted">Arrondir {fmt(d)} à</span>
              {choices.map((v) => (
                <button key={v} type="button" className={`chip ${Number(amount) === v ? 'active' : ''}`} onClick={() => onAmount(String(v))}>{fmt(v)}</button>
              ))}
            </div>
          ) : (
            <p className="muted">Le dû est déjà rond : rien à arrondir.</p>
          )}
        </div>
      )}

      {rm.kind === 'settle' && (
        <p className="muted rb-hint">
          <strong>Total convenu</strong> : tapez dans « Montant » le total que la personne règle vraiment. La différence avec
          le dû devient la remise, et le compte est soldé.
        </p>
      )}

      {rm.kind !== 'none' && (
        <>
          <div className="rb-sum" role="status">
            {figures.pending ? (
              <span className="muted">
                {rm.kind === 'settle' ? 'Tapez le total convenu dans « Montant » : la remise s’en déduit.' : 'Indiquez la remise : le versement se recalcule.'}
              </span>
            ) : (
              <>
                <span>Dû <b>{formatMoney(d, currency)}</b></span>
                <span className="rb-op">{figures.diff >= 0 ? '−' : '+'}</span>
                <span>remise <b>{formatMoney(Math.abs(figures.diff), currency)}</b>{figures.percent != null && <i> ({fmt(Math.abs(figures.percent))} %)</i>}</span>
                <span className="rb-op">=</span>
                <span>à verser <b className="rb-pay">{formatMoney(Number(amount) || 0, currency)}</b></span>
              </>
            )}
          </div>
          {figures.error && <p className="rb-err" role="alert">{figures.error}</p>}
          {figures.active && figures.left > 0 && (
            <p className="muted rb-hint">Il restera {formatMoney(figures.left, currency)} dû : la dette reste ouverte.</p>
          )}

          <div className="rb-why">
            <span className="muted">Motif</span>
            <div className="round-chips" role="group" aria-label="Motif de la remise">
              {list.map((r) => (
                <button key={r.id} type="button" className={`chip ${Number(rm.reasonId) === r.id ? 'active' : ''}`}
                  onClick={() => onChange({ ...rm, reasonId: Number(rm.reasonId) === r.id ? null : r.id })}>{r.label}</button>
              ))}
            </div>
            <input className="rb-note" value={rm.note} maxLength={300} placeholder="Précision sur la remise (optionnel)" onChange={(e) => onChange({ ...rm, note: e.target.value })} />
          </div>
        </>
      )}
    </div>
  );
}
