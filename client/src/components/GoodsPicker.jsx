import { useMemo, useState } from 'react';
import { IconEl } from './icons.jsx';
import { fuzzyRank } from '../lib/fuzzy.js';
import { formatMoney } from './ui.jsx';
import { formatQty } from '../lib/format.js';
import AmountInput from './AmountInput.jsx';

// Ce qui part avec le passager.
//
// À gauche ce qui est disponible aujourd'hui, groupé par fournisseur ; à droite
// ce qu'on lui confie. Il n'y a plus de fournisseur à choisir d'abord : un
// passager voyage avec une valise et la remplit là où la marchandise est prête,
// donc un même bon peut porter les lots de trois fournisseurs.
//
// Le prix saisi est le PRIX DE REVIENT payé au passager ; le prix de vente vient
// du lot d'origine, et l'écart des deux est la marge, affichée en continu parce
// que c'est elle qui dit si le bon vaut la peine.

export const lotKey = (l) => String(l.line_id);
export const pickedTotal = (l) => Number(l.value || 0) * Number(l.unitPrice || 0);
export const pickedMargin = (l) => Number(l.value || 0) * (Number(l.salePrice || 0) - Number(l.unitPrice || 0));

// Complet : une quantité positive qui tient dans ce qui reste, et un prix.
export const pickedValid = (l) =>
  Number(l.value) > 0 && Number(l.value) <= Number(l.remaining) && Number(l.unitPrice) > 0;

// Un lot du catalogue devient une ligne du panier ; la quantité proposée est
// tout ce qui reste, parce que c'est le cas le plus fréquent.
export const lotToPicked = (o) => ({
  sourceLineId: o.line_id,
  designation: o.designation,
  measure: o.measure,
  unit: o.unit,
  remaining: Number(o.remaining),
  salePrice: Number(o.sale_price),
  fournisseurId: o.fournisseur_id,
  fournisseurName: o.fournisseur_name,
  sourceLabel: o.order_reference,
  value: String(o.remaining),
  unitPrice: '',
  note: '',
});

// Ce que POST /bons attend d'une ligne.
export const pickedToLine = (l) => ({
  sourceLineId: l.sourceLineId,
  measure: l.measure,
  value: l.value,
  unitPrice: l.unitPrice,
  note: l.note || undefined,
});

const unitOf = (m, unit) => (m === 'poids' ? 'kg' : m === 'cbm' ? 'm³' : unit || 'u');
const groupBy = (rows, key) => {
  const out = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return [...out.entries()];
};

export function GoodsPicker({ options, picked, currency, onChange, loading }) {
  const [query, setQuery] = useState('');
  const [openCatalogue, setOpenCatalogue] = useState(true);

  const taken = useMemo(() => new Set(picked.map((l) => String(l.sourceLineId))), [picked]);

  // La recherche porte sur l'article, la référence du bon fournisseur et le nom
  // du fournisseur — les trois façons dont on cherche un lot.
  const matches = useMemo(
    () => (query
      ? fuzzyRank(query, options, (o) => `${o.designation} ${o.order_reference} ${o.fournisseur_name}`, 60)
      : options),
    [query, options]
  );
  const byFournisseur = useMemo(() => groupBy(matches, (o) => o.fournisseur_name || '—'), [matches]);
  const pickedByFournisseur = useMemo(() => groupBy(picked, (l) => l.fournisseurName || '—'), [picked]);

  const add = (o) => {
    if (taken.has(lotKey(o))) return;
    onChange([...picked, lotToPicked(o)]);
  };
  const patch = (i, p) => onChange(picked.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  const drop = (i) => onChange(picked.filter((_, idx) => idx !== i));

  const total = picked.reduce((s, l) => s + pickedTotal(l), 0);
  const margin = picked.reduce((s, l) => s + pickedMargin(l), 0);

  return (
    <div className="gp">
      {/* ── catalogue ── */}
      <section className={openCatalogue ? 'gp-pane gp-cat' : 'gp-pane gp-cat closed'}>
        <header className="gp-head">
          <button type="button" className="gp-fold" onClick={() => setOpenCatalogue((v) => !v)} aria-expanded={openCatalogue}>
            <IconEl name={openCatalogue ? 'chevronDown' : 'chevronRight'} />
            <span>Marchandises disponibles</span>
          </button>
          <span className="gp-count">{matches.length}</span>
        </header>

        <div className="gp-search">
          <IconEl name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Article, fournisseur, référence BF…"
          />
          {query && (
            <button type="button" className="gp-clear" onClick={() => setQuery('')} aria-label="Effacer">
              <IconEl name="close" />
            </button>
          )}
        </div>

        <div className="gp-list">
          {loading && <p className="gp-empty">Chargement…</p>}
          {!loading && !matches.length && (
            <p className="gp-empty">
              {options.length
                ? 'Aucun lot ne correspond à cette recherche.'
                : 'Aucune marchandise disponible : tout ce qui est arrivé est déjà confié.'}
            </p>
          )}

          {byFournisseur.map(([name, lots]) => (
            <div key={name} className="gp-group">
              <div className="gp-group-head">
                <IconEl name="fournisseur" />
                <span>{name}</span>
                <span className="gp-group-n">{lots.length}</span>
              </div>
              {lots.map((o) => {
                const isTaken = taken.has(lotKey(o));
                return (
                  <button
                    key={o.line_id}
                    type="button"
                    className={isTaken ? 'gp-lot taken' : 'gp-lot'}
                    onClick={() => add(o)}
                    disabled={isTaken}
                    title={isTaken ? 'Déjà dans le bon' : 'Ajouter au bon'}
                  >
                    <span className="gp-lot-main">
                      <span className="gp-lot-name">{o.designation}</span>
                      <span className="gp-lot-sub">{o.order_reference}</span>
                    </span>
                    <span className="gp-lot-qty">
                      {formatQty(o.remaining)} {unitOf(o.measure, o.unit)}
                    </span>
                    <span className="gp-lot-price">{formatMoney(o.sale_price)}</span>
                    <IconEl name={isTaken ? 'check' : 'plus'} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* ── panier ── */}
      <section className="gp-pane gp-cart">
        <header className="gp-head">
          <span className="gp-head-title">Confié au passager</span>
          <span className="gp-count">{picked.length}</span>
        </header>

        <div className="gp-list">
          {!picked.length && (
            <p className="gp-empty">
              Choisissez des lots à gauche. Un même bon peut porter la marchandise
              de plusieurs fournisseurs.
            </p>
          )}

          {pickedByFournisseur.map(([name, lots]) => (
            <div key={name} className="gp-group">
              <div className="gp-group-head">
                <IconEl name="fournisseur" />
                <span>{name}</span>
              </div>
              {lots.map((l) => {
                const i = picked.indexOf(l);
                const u = unitOf(l.measure, l.unit);
                const over = Number(l.value) > Number(l.remaining);
                const m = pickedMargin(l);
                return (
                  <div key={l.sourceLineId} className="gp-row">
                    <div className="gp-row-head">
                      <span className="gp-row-name">{l.designation}</span>
                      <button type="button" className="icon-btn" aria-label="Retirer du bon" onClick={() => drop(i)}>
                        <IconEl name="close" />
                      </button>
                    </div>
                    <div className="gp-row-fields">
                      <label className="field">
                        <span>Quantité <em className="gp-cap">/ {formatQty(l.remaining)} {u}</em></span>
                        <AmountInput
                          value={l.value}
                          decimals={3}
                          className={over ? 'input-error' : ''}
                          onChange={(v) => patch(i, { value: v })}
                        />
                      </label>
                      <label className="field">
                        <span>Prix de revient</span>
                        <AmountInput value={l.unitPrice} onChange={(v) => patch(i, { unitPrice: v })} />
                      </label>
                    </div>
                    <div className="gp-row-foot">
                      {over
                        ? <span className="neg">Il ne reste que {formatQty(l.remaining)} {u}.</span>
                        : <span className="muted">Vente {formatMoney(l.salePrice)} · {l.sourceLabel}</span>}
                      <span className="gp-row-total">
                        {formatMoney(pickedTotal(l), currency)}
                        <em className={m < 0 ? 'neg' : 'pos'}>marge {formatMoney(m, currency)}</em>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Les deux chiffres qui décident du bon, visibles pendant qu'on choisit. */}
        <footer className="gp-foot">
          <div>
            <span>À payer au passager</span>
            <strong>{formatMoney(total, currency)}</strong>
          </div>
          <div>
            <span>Marge estimée</span>
            <strong className={margin < 0 ? 'neg' : 'pos'}>{formatMoney(margin, currency)}</strong>
          </div>
        </footer>
      </section>
    </div>
  );
}
