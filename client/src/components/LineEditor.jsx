// One goods line for a bon: an article picker, a QUANTITÉ and a POIDS — both,
// always — and the price. `measure` only says which of the two the price
// multiplies (« Prix par : quantité | poids »). Used by the bon fournisseur forms.
import { useEffect, useRef } from 'react';
import { ArticlePicker } from './ArticlePicker.jsx';
import { IconEl } from './icons.jsx';
import AmountInput from './AmountInput.jsx';
import { formatNumber, formatQty } from '../lib/format.js';
import { priceBasis } from '../lib/lineMath.js';

export const emptyLine = () => ({
  designation: '', itemId: null, createItem: false, categoryId: '',
  measure: 'quantite', quantity: '', weight_kg: '', unit: 'pièce', unitPrice: '', note: '',
});

const MEASURES = [
  { key: 'quantite', label: 'Quantité' },
  { key: 'poids', label: 'Poids' },
];
const UNITS = ['pièce', 'carton', 'sac', 'palette', 'lot', 'paire'];

// Per-unit label for the price, per the line's pricing basis.
const perUnit = (l) => (l.measure === 'poids' ? '/ kg' : `/ ${l.unit || 'unité'}`);

// prix × (quantité ou poids) — the line's contribution to the transport fee.
export const lineTotal = (l) => priceBasis(l) * Number(l.unitPrice || 0);

// A line is complete when it names an article, carries a quantity AND a weight,
// and a positive price (the fee is derived from it).
export const lineValid = (l) =>
  (Boolean(l.itemId) || Boolean(String(l.designation || '').trim())) &&
  Number(l.quantity) > 0 && Number(l.weight_kg) > 0 && Number(l.unitPrice) > 0;

export function LineEditor({ line, items, categories, onPatch, onRemove, removable, autoFocus, allowCreate = true, suggestion = null }) {
  const patch = (p) => onPatch({ ...line, ...p });

  // Le dernier prix convenu se reprend tout seul des qu'un article est nomme —
  // mais jamais par-dessus une saisie : on ne remplit que le vide, et une seule
  // fois par article, sinon effacer le prix le ferait revenir.
  const articleKey = line.itemId ? `i${line.itemId}` : String(line.designation || '').trim().toLowerCase();
  const applied = useRef(null);
  useEffect(() => {
    if (!suggestion || !articleKey || applied.current === articleKey) return;
    if (String(line.unitPrice ?? '').trim() !== '') return;
    applied.current = articleKey;
    // Le prix, et la mesure que cet article prend d'habitude : un article qui se
    // tarife au poids depuis dix bons se propose au poids.
    onPatch({ ...line, unitPrice: String(suggestion.unit_price), measure: suggestion.suggested_measure ?? line.measure });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleKey, suggestion]);

  // When items carry a per-office quantity (passager bon picking from China
  // stock), show what's available for the chosen measure.
  const picked = line.itemId ? items.find((i) => i.id === line.itemId) : null;
  const avail = picked && picked.quantity != null
    ? `${formatQty(picked.quantity)} · ${formatQty(picked.weight_kg)} kg`
    : null;

  return (
    <div className="line-editor">
      <div className="line-article">
        <ArticlePicker line={line} items={items} categories={categories} onPatch={patch} autoFocus={autoFocus} allowCreate={allowCreate} />
        {avail != null && <span className="line-avail">Disponible : {avail}</span>}
      </div>

      <div className="line-measure">
        <AmountInput decimals={3}
          className="line-value"
          placeholder="Quantité"
          // Un carton se compte à l'unité : le pas est de un.
          step={1}
          value={line.quantity}
          onChange={(v) => patch({ quantity: v })}
        />

        <select className="line-unit" value={line.unit} onChange={(e) => patch({ unit: e.target.value })}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>

        <AmountInput decimals={3}
          className="line-value"
          placeholder="Poids (kg)"
          step={1}
          value={line.weight_kg}
          onChange={(v) => patch({ weight_kg: v })}
        />

        <div className="line-price">
          <div className="seg seg-measure" role="group" aria-label="Le prix se multiplie par">
            {MEASURES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={line.measure === m.key ? 'active' : ''}
                title={`Le prix se multiplie par ${m.key === 'poids' ? 'le poids' : 'la quantité'}`}
                onClick={() => patch({ measure: m.key })}
              >
                {m.label}
              </button>
            ))}
          </div>
          <AmountInput
            className="line-value"
            placeholder="Prix de revient"
            value={line.unitPrice}
            onChange={(v) => patch({ unitPrice: v })}
          />
          <span className="line-per">{perUnit(line)}</span>
        </div>

        {removable && (
          <button type="button" className="btn btn-ghost btn-sm line-remove" onClick={onRemove} aria-label="Retirer la ligne">✕</button>
        )}
      </div>

      {suggestion && (
        <button
          type="button"
          className="line-sugg"
          onClick={() => patch({ unitPrice: String(suggestion.unit_price), measure: suggestion.suggested_measure ?? line.measure })}
          title="Reprendre ce prix"
        >
          <IconEl name="trend" />
          <span>{formatNumber(suggestion.unit_price, { decimals: 2, trim: true })}</span>
          <em>{suggestion.own ? 'dernier avec ce fournisseur' : 'dernier prix vu'}{suggestion.reference ? ` · ${suggestion.reference}` : ''}</em>
        </button>
      )}

      {priceBasis(line) > 0 && Number(line.unitPrice) > 0 && (
        <div className="line-total">= {formatNumber(lineTotal(line), { decimals: 2, trim: true })}</div>
      )}
    </div>
  );
}
