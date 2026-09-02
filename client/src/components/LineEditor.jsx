// One goods line for a bon: an article picker + a single measure (Quantité, Poids,
// or CBM) — the user chooses one and fills only that value. Used by both the bon
// fournisseur (OrdersPage) and bon passager (BonsPage) forms.
import { ArticlePicker } from './ArticlePicker.jsx';

export const emptyLine = () => ({
  designation: '', itemId: null, createItem: false, categoryId: '',
  measure: 'quantite', value: '', unit: 'pièce', unitPrice: '', note: '',
});

const MEASURES = [
  { key: 'quantite', label: 'Quantité' },
  { key: 'poids', label: 'Poids (kg)' },
  { key: 'cbm', label: 'CBM (m³)' },
];
const UNITS = ['pièce', 'carton', 'sac', 'palette', 'lot', 'paire'];

// Per-unit label for the prix de revient, per the line's measure.
const perUnit = (m) => (m === 'poids' ? '/ kg' : m === 'cbm' ? '/ m³' : '/ unité');

// value × prix de revient — the line's contribution to the transport fee.
export const lineTotal = (l) => Number(l.value || 0) * Number(l.unitPrice || 0);

// A line is complete when it names an article, has a positive measure, and a
// positive prix de revient (the fee is derived from it).
export const lineValid = (l) =>
  (Boolean(l.itemId) || Boolean(String(l.designation || '').trim())) &&
  Number(l.value) > 0 && Number(l.unitPrice) > 0;

export function LineEditor({ line, items, categories, onPatch, onRemove, removable, autoFocus, allowCreate = true }) {
  const patch = (p) => onPatch({ ...line, ...p });

  // When items carry a per-office quantity (passager bon picking from China
  // stock), show what's available for the chosen measure.
  const picked = line.itemId ? items.find((i) => i.id === line.itemId) : null;
  const avail = picked && picked.quantity != null
    ? (line.measure === 'poids' ? picked.weight_kg : line.measure === 'cbm' ? picked.cbm : picked.quantity)
    : null;

  return (
    <div className="line-editor">
      <div className="line-article">
        <ArticlePicker line={line} items={items} categories={categories} onPatch={patch} autoFocus={autoFocus} allowCreate={allowCreate} />
        {avail != null && <span className="line-avail">Disponible : {Number(avail).toLocaleString('fr-FR', { maximumFractionDigits: 3 })}</span>}
      </div>

      <div className="line-measure">
        <div className="seg seg-measure">
          {MEASURES.map((m) => (
            <button
              key={m.key}
              type="button"
              className={line.measure === m.key ? 'active' : ''}
              onClick={() => patch({ measure: m.key })}
            >
              {m.label}
            </button>
          ))}
        </div>

        <input
          className="line-value"
          inputMode="decimal"
          placeholder={line.measure === 'quantite' ? 'Qté' : line.measure === 'poids' ? 'kg' : 'm³'}
          value={line.value}
          onChange={(e) => patch({ value: e.target.value.replace(',', '.') })}
        />

        {line.measure === 'quantite' && (
          <select className="line-unit" value={line.unit} onChange={(e) => patch({ unit: e.target.value })}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        )}

        <div className="line-price">
          <input
            className="line-value"
            inputMode="decimal"
            placeholder="Prix de revient"
            value={line.unitPrice}
            onChange={(e) => patch({ unitPrice: e.target.value.replace(',', '.') })}
          />
          <span className="line-per">{perUnit(line.measure)}</span>
        </div>

        {removable && (
          <button type="button" className="btn btn-ghost btn-sm line-remove" onClick={onRemove} aria-label="Retirer la ligne">✕</button>
        )}
      </div>

      {Number(line.value) > 0 && Number(line.unitPrice) > 0 && (
        <div className="line-total">= {lineTotal(line).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</div>
      )}
    </div>
  );
}
