import { useMemo, useState } from 'react';
import { IconEl } from './icons.jsx';
import { fuzzyRank } from '../lib/fuzzy.js';
import { formatMoney } from './ui.jsx';
import { formatQty } from '../lib/format.js';
import AmountInput from './AmountInput.jsx';
import { priceBasis, weightShare, perPiece, perMeasureUnit, priceUnit } from '../lib/lineMath.js';

// Ce qui part avec le passager.
//
// À gauche ce qui est disponible aujourd'hui, groupé par fournisseur ; à droite
// le panier. Il n'y a pas de fournisseur à choisir d'abord : un passager voyage
// avec une valise et la remplit là où la marchandise est prête, donc un même bon
// peut porter les lots de trois fournisseurs. On voit de qui vient chaque lot,
// sans que ça commande quoi que ce soit.
//
// Chaque ligne du panier porte DEUX prix, parce que ce sont deux accords
// différents :
//   • le PRIX DE TRANSPORT, ce qu'on paie au passager par unité ;
//   • la VALEUR DU MANQUANT, ce qu'il devra par unité non livrée — proposée au
//     prix convenu avec le fournisseur, puisque c'est celle-là qu'il faudra
//     rembourser.

export const lotKey = (l) => String(l.line_id);

// Une ligne du panier tire en QUANTITÉ sur un lot ; son poids en est la part, et
// `measure` dit seulement si le prix se multiplie par la quantité ou par le poids.
const round2 = (v) => String(Math.round(Number(v) * 100) / 100);
const lotOf = (l) => l.lot; // { measure, quantity, weight_kg } — la ligne du bon fournisseur

export const pickedTotal = (l) => priceBasis(l) * Number(l.unitPrice || 0);
// Ce que le fournisseur paie pour ces pièces, moins ce qu'on paie le passager.
export const pickedMargin = (l) => perPiece(lotOf(l), l.salePrice) * Number(l.quantity || 0) - pickedTotal(l);

// Complet : une quantité positive qui tient dans ce qui reste, un poids, un prix
// de transport, et une valeur du manquant renseignée (zéro compris : un lot sans
// valeur déclarée est une décision, pas un oubli).
export const pickedValid = (l) =>
  Number(l.quantity) > 0 && Number(l.quantity) <= Number(l.remaining)
  && Number(l.weight_kg) > 0
  && Number(l.unitPrice) > 0
  && String(l.missingPrice ?? '').trim() !== '' && Number(l.missingPrice) >= 0;

// La valeur du manquant convenue avec le fournisseur est par unité de la mesure
// DU LOT ; ce bon peut tarifer autrement (au kilo ce que le lot vend à la pièce).
// On la ramène à la pièce, puis à la mesure de cette ligne.
export const defaultMissing = (l) => {
  const lot = lotOf(l);
  if (lot.measure === l.measure) return String(l.salePrice);
  return round2(perMeasureUnit(l, perPiece(lot, l.salePrice)));
};

// Un lot du catalogue devient une ligne du panier. La quantité proposée est tout
// ce qui reste — le cas le plus fréquent —, la mesure du prix est celle que cet
// article prend d'habitude (sinon celle du lot), la valeur du manquant est celle
// convenue avec le fournisseur, et le prix de transport vient de ce qu'on a payé
// la dernière fois, s'il y a une dernière fois.
export const lotToPicked = (o, suggestion = null) => {
  const lot = { measure: o.measure, quantity: Number(o.quantity), weight_kg: Number(o.weight_kg) };
  const measure = suggestion?.suggested_measure ?? o.measure ?? 'quantite';
  const quantity = Number(o.remaining);
  const line = {
    sourceLineId: o.line_id,
    designation: o.designation,
    measure,
    unit: o.unit,
    lot,
    remaining: quantity,
    salePrice: Number(o.sale_price),
    fournisseurId: o.fournisseur_id,
    fournisseurName: o.fournisseur_name,
    sourceLabel: o.order_reference,
    quantity: String(quantity),
    weight_kg: String(weightShare(lot, quantity)),
    unitPrice: suggestion ? String(suggestion.unit_price) : '',
    suggestion,
    note: '',
  };
  return { ...line, missingPrice: defaultMissing(line) };
};

// Ce que POST /bons attend d'une ligne.
export const pickedToLine = (l) => ({
  sourceLineId: l.sourceLineId,
  measure: l.measure,
  quantity: l.quantity,
  weight_kg: l.weight_kg,
  unitPrice: l.unitPrice,
  missingUnitPrice: l.missingPrice,
  note: l.note || undefined,
});

// Modifier une ligne du panier garde ses valeurs DÉRIVÉES cohérentes tant que la
// personne n'y a pas touché : le poids suit la quantité, et la valeur du manquant
// suit la mesure. Une fois saisis à la main, ils ne bougent plus.
export const patchPicked = (l, p) => {
  const next = { ...l, ...p };
  if ('weight_kg' in p) next.weightTouched = true;
  if ('missingPrice' in p) next.missingTouched = true;
  if ('quantity' in p && !next.weightTouched) next.weight_kg = String(weightShare(lotOf(next), p.quantity));
  if (('measure' in p || 'quantity' in p || 'weight_kg' in p) && !next.missingTouched) next.missingPrice = defaultMissing(next);
  return next;
};

const groupBy = (rows, key) => {
  const out = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return [...out.entries()];
};

// Ce que le passager emporte physiquement : des cartons et des kilos. Des unités
// différentes ne s'additionnent pas (des cartons et des sacs), mais le poids,
// si — et c'est lui qu'on vérifie contre une limite de bagage.
function measureTotals(picked) {
  const acc = new Map();
  let kg = 0;
  for (const l of picked) {
    const u = l.unit || 'u';
    acc.set(u, (acc.get(u) || 0) + Number(l.quantity || 0));
    kg += Number(l.weight_kg || 0);
  }
  const parts = [...acc.entries()].map(([u, v]) => `${formatQty(v)} ${u}`);
  if (kg > 0) parts.push(`${formatQty(kg)} kg`);
  return parts;
}

export function GoodsPicker({ options, picked, currency, onChange, loading, suggestFor }) {
  const [query, setQuery] = useState('');
  const [openCatalogue, setOpenCatalogue] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

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
    onChange([...picked, lotToPicked(o, suggestFor ? suggestFor(o) : null)]);
  };
  const patch = (i, p) => onChange(picked.map((l, idx) => (idx === i ? patchPicked(l, p) : l)));
  const drop = (i) => onChange(picked.filter((_, idx) => idx !== i));

  const total = picked.reduce((s, l) => s + pickedTotal(l), 0);
  const margin = picked.reduce((s, l) => s + pickedMargin(l), 0);
  const loads = measureTotals(picked);

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
                    title={isTaken ? 'Déjà dans le panier' : 'Ajouter au panier'}
                  >
                    <span className="gp-lot-main">
                      <span className="gp-lot-name">{o.designation}</span>
                      <span className="gp-lot-sub">{o.order_reference}</span>
                    </span>
                    <span className="gp-lot-qty">
                      {formatQty(o.remaining)} {o.unit}
                      <em> · {formatQty(weightShare({ quantity: o.quantity, weight_kg: o.weight_kg }, o.remaining))} kg</em>
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
          <span className="gp-head-title">Panier du passager</span>
          <span className="gp-count">{picked.length}</span>
          {picked.length > 0 && (
            confirmClear ? (
              <span className="gp-confirm">
                <button type="button" className="gp-confirm-yes" onClick={() => { onChange([]); setConfirmClear(false); }}>
                  Tout retirer
                </button>
                <button type="button" className="gp-confirm-no" onClick={() => setConfirmClear(false)}>Annuler</button>
              </span>
            ) : (
              <button type="button" className="gp-empty-btn" onClick={() => setConfirmClear(true)}>
                <IconEl name="trash" />Vider
              </button>
            )
          )}
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
                {/* Ce que ce fournisseur-là met dans la valise. */}
                <span className="gp-group-sum">{formatMoney(lots.reduce((s, l) => s + pickedTotal(l), 0), currency)}</span>
              </div>
              {lots.map((l) => {
                const i = picked.indexOf(l);
                const u = l.unit;
                const over = Number(l.quantity) > Number(l.remaining);
                const m = pickedMargin(l);
                return (
                  <div key={l.sourceLineId} className="gp-row">
                    <div className="gp-row-head">
                      <span className="gp-row-name">{l.designation}</span>
                      <button type="button" className="icon-btn" aria-label="Retirer du panier" onClick={() => drop(i)}>
                        <IconEl name="close" />
                      </button>
                    </div>
                    <div className="gp-row-fields">
                      <label className="field">
                        <span>Quantité <em className="gp-cap">/ {formatQty(l.remaining)} {u}</em></span>
                        <AmountInput
                          value={l.quantity}
                          decimals={3}
                          // Le pas s'arrête sur ce qui reste dans le lot : on ne
                          // peut plus dépasser en cliquant, seulement en tapant.
                          step={1}
                          max={l.remaining}
                          className={over ? 'input-error' : ''}
                          onChange={(v) => patch(i, { quantity: v })}
                        />
                      </label>
                      <label className="field">
                        <span>Poids <em className="gp-cap">kg</em></span>
                        <AmountInput value={l.weight_kg} decimals={3} step={1} onChange={(v) => patch(i, { weight_kg: v })} />
                      </label>
                      <div className="field gp-basis" role="group" aria-label="Le prix se multiplie par">
                        <span>Prix par</span>
                        <div className="seg seg-measure">
                          {[['quantite', 'Quantité'], ['poids', 'Poids']].map(([k, label]) => (
                            <button key={k} type="button" className={l.measure === k ? 'active' : ''} onClick={() => patch(i, { measure: k })}>{label}</button>
                          ))}
                        </div>
                      </div>
                      <label className="field">
                        <span>Prix de transport <em className="gp-cap">/ {priceUnit(l)}</em></span>
                        <AmountInput value={l.unitPrice} onChange={(v) => patch(i, { unitPrice: v })} />
                      </label>
                      <label className="field">
                        <span>Valeur du manquant <em className="gp-cap">/ {priceUnit(l)}</em></span>
                        <AmountInput value={l.missingPrice} onChange={(v) => patch(i, { missingPrice: v })} />
                      </label>
                    </div>
                    {/* D'où vient le prix proposé : un clic le reprend s'il a été modifié. */}
                    {l.suggestion && (
                      <button
                        type="button"
                        className="gp-sugg"
                        onClick={() => patch(i, { unitPrice: String(l.suggestion.unit_price), ...(l.suggestion.suggested_measure ? { measure: l.suggestion.suggested_measure } : {}) })}
                        title="Reprendre ce prix"
                      >
                        <IconEl name="trend" />
                        {formatMoney(l.suggestion.unit_price)} · {l.suggestion.own ? 'dernier avec ce passager' : 'dernier prix vu'}
                        {l.suggestion.reference ? ` · ${l.suggestion.reference}` : ''}
                      </button>
                    )}
                    <div className="gp-row-foot">
                      {over
                        ? <span className="neg">Il ne reste que {formatQty(l.remaining)} {u}.</span>
                        : <span className="muted">Fournisseur {formatMoney(l.salePrice)} / {priceUnit({ measure: l.lot.measure, unit: l.unit })} · {l.sourceLabel}</span>}
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

        {/* Ce que le bon coûte, ce qu'il rapporte, et ce que le passager porte. */}
        <footer className="gp-foot">
          <div>
            <span>À payer au passager</span>
            <strong>{formatMoney(total, currency)}</strong>
          </div>
          <div>
            <span>Marge estimée</span>
            <strong className={margin < 0 ? 'neg' : 'pos'}>{formatMoney(margin, currency)}</strong>
          </div>
          {loads.length > 0 && (
            <div className="gp-load">
              <span>Charge</span>
              <strong>{loads.join(' · ')}</strong>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}
