// One goods line of a bon PASSAGER: it draws from a specific bon fournisseur
// line. You pick which fournisseur goods to carry (fuzzy search over what is
// still unallocated), how much of it to take, and the prix de revient paid to
// the passager for that unit. The sale price billed to the fournisseur comes
// from the source line, so the margin is shown live.
import { useState, useMemo, useRef } from 'react';
import { useDismiss } from './SettingsMenu.jsx';
import { fuzzyRank } from '../lib/fuzzy.js';
import { formatMoney } from './ui.jsx';

export const emptySourceLine = () => ({
  sourceLineId: null, designation: '', measure: 'quantite', unit: 'pièce',
  remaining: 0, salePrice: 0, sourceLabel: '', value: '', unitPrice: '', note: '',
});

export const sourceLineTotal = (l) => Number(l.value || 0) * Number(l.unitPrice || 0);
export const sourceLineMargin = (l) => Number(l.value || 0) * (Number(l.salePrice || 0) - Number(l.unitPrice || 0));

// Complete when a source is chosen, the quantity is positive and within what
// remains, and a prix de revient is set.
export const sourceLineValid = (l) =>
  Boolean(l.sourceLineId) && Number(l.value) > 0 &&
  Number(l.value) <= Number(l.remaining) && Number(l.unitPrice) > 0;

const unitOf = (m, unit) => (m === 'poids' ? 'kg' : m === 'cbm' ? 'm³' : unit || 'u');
const q3 = (v) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

export function SourceLineEditor({ line, options, currency, onPatch, onRemove, removable, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useDismiss(open, () => setOpen(false));
  const inputRef = useRef(null);
  const patch = (p) => onPatch({ ...line, ...p });

  // Search across article name, fournisseur bon reference and fournisseur name.
  const matches = useMemo(
    () => fuzzyRank(query, options, (o) => `${o.designation} ${o.order_reference} ${o.fournisseur_name}`, 8),
    [query, options]
  );

  const pick = (o) => {
    onPatch({
      ...line,
      sourceLineId: o.line_id,
      designation: o.designation,
      measure: o.measure,
      unit: o.unit,
      remaining: Number(o.remaining),
      salePrice: Number(o.sale_price),
      sourceLabel: o.order_reference,
    });
    setQuery('');
    setOpen(false);
  };

  const over = Number(line.value) > Number(line.remaining);
  const u = unitOf(line.measure, line.unit);

  return (
    <div className="line-editor">
      <div className="line-article" ref={ref}>
        <div className="article-input">
          <input
            ref={inputRef}
            autoFocus={autoFocus}
            value={line.sourceLineId ? line.designation : query}
            placeholder="Marchandise d'un bon fournisseur…"
            onChange={(e) => { setQuery(e.target.value); if (line.sourceLineId) onPatch({ ...emptySourceLine(), value: line.value, unitPrice: line.unitPrice }); setOpen(true); }}
            onFocus={() => setOpen(true)}
          />
        </div>

        {line.sourceLineId ? (
          <span className="line-avail">
            {line.sourceLabel} · reste {q3(line.remaining)} {u} · vente {formatMoney(line.salePrice, currency)}/{u}
          </span>
        ) : null}

        {open && matches.length > 0 && (
          <div className="article-menu" role="listbox">
            {matches.map((o) => (
              <button type="button" key={o.line_id} className="article-opt" onClick={() => pick(o)}>
                <span className="article-opt-name">{o.designation}</span>
                <span className="article-opt-cat">
                  {o.order_reference} · reste {q3(o.remaining)} {unitOf(o.measure, o.unit)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="line-measure">
        <input
          className={`line-value ${over ? 'input-error' : ''}`}
          inputMode="decimal"
          placeholder={u}
          value={line.value}
          onChange={(e) => patch({ value: e.target.value.replace(',', '.') })}
          disabled={!line.sourceLineId}
        />
        <span className="line-per">{u}</span>

        <div className="line-price">
          <input
            className="line-value"
            inputMode="decimal"
            placeholder="Prix passager"
            value={line.unitPrice}
            onChange={(e) => patch({ unitPrice: e.target.value.replace(',', '.') })}
            disabled={!line.sourceLineId}
          />
          <span className="line-per">/ {u}</span>
        </div>

        {removable && (
          <button type="button" className="btn btn-ghost btn-sm line-remove" onClick={onRemove} aria-label="Retirer la ligne">✕</button>
        )}
      </div>

      {sourceLineValid(line) && (
        <div className="line-total">
          Passager {formatMoney(sourceLineTotal(line), currency)}
          <span className="line-margin"> · marge {formatMoney(sourceLineMargin(line), currency)}</span>
        </div>
      )}
      {over && <div className="line-avail neg">Dépasse le stock disponible ({q3(line.remaining)} {u}).</div>}
    </div>
  );
}
