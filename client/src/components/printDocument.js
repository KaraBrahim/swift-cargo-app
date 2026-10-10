// Shared printing for every document in the app.
//
// Client-side on purpose: the same black-on-white page a server PDF would
// give, with no dependency. Printing goes through a hidden iframe; the desk
// app saves PDFs itself (desktop/main.js).
import { formatMoney } from './ui.jsx';
import { formatQty, formatDateFr } from '../lib/format.js';
import { priceBasis, pricedPart, weightShare, priceUnit } from '../lib/lineMath.js';
import { describeEvent, describeBonEvent, dayOf } from '../lib/journalText.js';
import { BON_STATUS } from './bonStatus.js';
import { ORDER_STATUS } from './orderStatus.js';

// Imprimer un document HTML complet SANS ouvrir de fenêtre.
//
// window.open() est une fenêtre surgissante : un bloqueur la refuse, et
// l'application de bureau refuse toute nouvelle fenêtre. Un iframe caché dans
// la page courante est de la même origine, ne demande rien à personne et
// s'imprime avec la même boîte de dialogue. Il est retiré une fois imprimé.
export function printHtml(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const w = frame.contentWindow;
  const remove = () => setTimeout(() => frame.remove(), 500);
  w.addEventListener('afterprint', remove, { once: true });
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Sans onload, Chrome imprime parfois avant la mise en page des tableaux.
  frame.onload = () => { w.focus(); w.print(); };
  return true;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const num = (v) => formatQty(v);
// Une date du calendrier, sans passer par new Date() (qui la décale d'un jour).
const dayFr = (iso) => (iso ? esc(formatDateFr(iso)) : '—');

// Shared stylesheet — matches the printed bon so every document looks like one
// family, independent of whichever of the four screen themes is active.
export const PRINT_CSS = `
  * { font-family: Arial, Helvetica, sans-serif; color: #111; }
  body { margin: 32px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #C8A84B; padding-bottom:12px; }
  .brand { font-weight:800; letter-spacing:3px; color:#9A7C30; font-size:20px; }
  .sub { font-size:12px; color:#555; margin-top:2px; }
  h1 { margin:4px 0; font-size:20px; }
  .meta { margin:16px 0; display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; font-size:13px; }
  .k { color:#666; margin-right:6px; }
  table { width:100%; border-collapse:collapse; margin-top:12px; font-size:12.5px; }
  th,td { border:1px solid #ccc; padding:6px 9px; text-align:left; }
  th { background:#f4efe0; }
  .r { text-align:right; }
  .totals { margin-top:14px; text-align:right; font-size:14px; }
  .totals strong { color:#9A7C30; }
  .totals .big { font-size:16px; }
  h2 { margin:18px 0 0; font-size:14px; letter-spacing:1px; text-transform:uppercase; color:#9A7C30; }
  tfoot th { background:#faf7ee; }
  .small { font-size:11px; color:#666; margin:6px 0 0; }
  .muted { color:#888; text-align:center; }
  .foot { margin-top:26px; border-top:1px solid #ddd; padding-top:8px; font-size:11px; color:#666; }
  .sign { margin-top:44px; display:flex; justify-content:space-between; font-size:13px; }
  .sign div { border-top:1px solid #999; padding-top:6px; width:30%; text-align:center; }
  /* Le code qui ramène ce papier dans le système, avec sa référence en clair
     dessous : un QR abîmé doit rester retapable. */
  .qr { margin-top:22px; text-align:center; }
  .qr img { width:104px; height:104px; image-rendering:pixelated; }
  .qr div { margin-top:4px; font-size:11px; letter-spacing:1px; color:#666; }
  /* La barre d'avancement : en couleur à l'écran et sur PDF, et dite en toutes
     lettres dessous pour qu'un tirage noir et blanc ne perde rien. */
  .pgbar { height:10px; border:1px solid #bbb; border-radius:6px; overflow:hidden; margin:8px 0 6px;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; background:#f2f2f2; }
  .pgbar span { display:block; float:left; height:100%; }
  .pglegend { display:flex; flex-wrap:wrap; gap:3px 14px; font-size:11.5px; }
  .pglegend i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px; border:1px solid #888;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .jr-print td { vertical-align: top; }
  .jr-print .nw { white-space: nowrap; }
  /* The app's own layout must never clip a multi-page document. */
  @media print { body { margin:12mm; } .no-print { display:none !important; }
    html, body { overflow:visible !important; height:auto !important; } }
`;

// A5 : le format des bons. Même famille que l'A4, resserrée pour tenir sur une
// demi-feuille — marges de la page, police et tableaux plus petits.
const A5_CSS = `
  @page { size: A5 portrait; margin: 9mm; }
  @media print { body.paper-a5 { margin: 0; } }
  .paper-a5 { margin: 0; }
  .paper-a5 .head { padding-bottom: 8px; border-bottom-width: 2px; }
  .paper-a5 .brand { font-size: 15px; letter-spacing: 2px; }
  .paper-a5 h1 { font-size: 15px; }
  .paper-a5 .sub { font-size: 10.5px; }
  .paper-a5 .meta { margin: 10px 0; gap: 4px 14px; font-size: 11px; }
  .paper-a5 table { margin-top: 8px; font-size: 10.5px; }
  .paper-a5 th, .paper-a5 td { padding: 3px 5px; }
  .paper-a5 h2 { margin-top: 12px; font-size: 12px; }
  .paper-a5 .totals { margin-top: 10px; font-size: 12px; }
  .paper-a5 .totals .big { font-size: 13.5px; }
  .paper-a5 .small { font-size: 9.5px; }
  .paper-a5 .foot { margin-top: 14px; font-size: 9.5px; }
  .paper-a5 .sign { margin-top: 26px; font-size: 11px; }
  .paper-a5 .qr { margin-top: 12px; }
  .paper-a5 .qr img { width: 78px; height: 78px; }
  /* Une ligne de tableau ne se coupe pas entre deux pages. */
  .paper-a5 tr { page-break-inside: avoid; }
`;

// L'avancement de la marchandise, tel que le serveur le calcule
// (server/src/lib/progress.js) : une barre, puis chaque tranche en chiffres et
// en pourcentage. Rien n'est recalculé ici.
const PROGRESS_TONE = { muted: '#d4d4d4', gold: '#C8A84B', red: '#d9534f', blue: '#4f7cd6', green: '#3aa86b' };
export function progressBlock(progress, title = 'Avancement') {
  const segs = progress?.segments;
  if (!segs?.length) return '';
  const bar = segs.filter((s) => s.pct > 0)
    .map((s) => `<span style="width:${s.pct}%;background:${PROGRESS_TONE[s.tone] || '#999'}"></span>`).join('');
  const legend = segs.map((s) => `<span><i style="background:${PROGRESS_TONE[s.tone] || '#999'}"></i>${esc(s.label)} :
      ${s.value != null ? `${num(s.value)} ${esc(progress.unit || '')} · ` : ''}<strong>${num(s.pct)} %</strong></span>`).join('');
  return `<h2>${esc(title)}</h2><div class="pgbar">${bar}</div><div class="pglegend">${legend}</div>`;
}

// Le journal sur le papier : date, et ce qui s'est passé. Les mêmes phrases que
// l'écran (lib/journalText.js) — le papier ne dit pas autre chose.
export function journalBlock(events, { title = 'Journal', describe = describeEvent, withLine = false } = {}) {
  if (!events?.length) return '';
  const rows = events.map((e) => {
    const d = describe(e);
    return `<tr>
      <td class="nw">${esc(dayOf(e) ? formatDateFr(dayOf(e), { year: false }) : '—')}</td>
      ${withLine ? `<td>${esc(e.designation || '')}</td>` : ''}
      <td>${esc(d.title)}${d.detail ? `<div class="small">${esc(d.detail)}</div>` : ''}</td>
    </tr>`;
  }).join('');
  return `<h2>${esc(title)}</h2>
    <table class="jr-print">
      <thead><tr><th>Date</th>${withLine ? '<th>Marchandise</th>' : ''}<th>Ce qui s'est passé</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Le bloc scannable. Rien si la page n'a pas (encore) produit l'image : un
// document sans QR reste un document valide, il se retrouve à la référence.
export const qrBlock = (qr, reference) =>
  (qr ? `<div class="qr"><img src="${qr}" alt=""><div>${esc(reference || '')}</div></div>` : '');

// Open a standalone window with a finished document and trigger the print dialog.
export function printWindowHtml({ title, societe, docTitle, subtitle, body, paper = 'a4' }) {
  const s = societe ?? {};
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <title>${esc(title)}</title><style>${PRINT_CSS}${paper === 'a5' ? A5_CSS : ''}</style></head><body${paper === 'a5' ? ' class="paper-a5"' : ''}>
    <div class="head">
      <div>
        <div class="brand">${esc(s.nom || 'SWIFT CARGO')}</div>
        <div class="sub">${esc(s.adresse || '')}${s.telephone ? ` · ${esc(s.telephone)}` : ''}</div>
      </div>
      <div style="text-align:right">
        <h1>${esc(docTitle)}</h1>
        <div class="sub">${esc(subtitle || '')}</div>
        <div class="sub">Édité le ${new Date().toLocaleString('fr-FR')}</div>
      </div>
    </div>
    ${body}
    <div class="foot">${esc(s.pied_de_page || 'Document généré par Swift Cargo')}</div>
  </body></html>`;
  return html;
}

export const openPrintWindow = (doc) => printHtml(printWindowHtml(doc));

// Print a region of the current page (used by Rapports, which already renders
// the tables on screen — no point rebuilding them as a string).
export function printDocument(elementId, docTitle) {
  const el = document.getElementById(elementId);
  if (!el) return false;
  return openPrintWindow({ title: docTitle, docTitle, subtitle: '', body: el.innerHTML });
}

// ── Document builders ────────────────────────────────────────────────
const rows = (arr, cells) => arr.map((r) => `<tr>${cells(r)}</tr>`).join('');

export function caisseStatementBody(d) {
  return `
    <div class="meta">
      <div><span class="k">Caisse :</span>${esc(d.caisse.label)}</div>
      <div><span class="k">Devise :</span>${esc(d.currency)}</div>
      <div><span class="k">Solde d'ouverture :</span>${formatMoney(d.soldeOuverture)} ${esc(d.currency)}</div>
      <div><span class="k">Solde de clôture :</span><strong>${formatMoney(d.soldeCloture)} ${esc(d.currency)}</strong></div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Note</th><th class="r">Entrée</th><th class="r">Sortie</th><th class="r">Solde</th></tr></thead>
      <tbody>${rows(d.entries, (e) => `
        <td>${new Date(e.created_at).toLocaleString('fr-FR')}</td>
        <td>${esc(e.type)}</td>
        <td>${esc(e.note || '')}</td>
        <td class="r">${e.direction === 'in' ? formatMoney(e.amount) : ''}</td>
        <td class="r">${e.direction === 'out' ? formatMoney(e.amount) : ''}</td>
        <td class="r">${formatMoney(e.solde)}</td>`)}
      </tbody>
    </table>
    <div class="totals">
      Total entrées : <strong>${formatMoney(d.entrees)} ${esc(d.currency)}</strong><br>
      Total sorties : ${formatMoney(d.depenses)} ${esc(d.currency)}
    </div>`;
}

// Une fiche peut tenir les deux rôles : l'en-tête du relevé les nomme tels
// qu'ils sont plutôt que d'en choisir un au hasard.
const rolesLabel = (p) => {
  const r = [p.is_fournisseur && 'Fournisseur', p.is_passager && 'Passager'].filter(Boolean);
  return r.length ? r.join(' · ') : 'Personne';
};

export function personStatementBody(d, qr) {
  const owed = Number(d.solde);
  return `
    <div class="meta">
      <div><span class="k">${rolesLabel(d.person)} :</span>${esc(d.person.name)}</div>
      <div><span class="k">Téléphone :</span>${esc(d.person.phone || '—')}</div>
      <div><span class="k">Devise :</span>${esc(d.currency)}</div>
      <div><span class="k">Solde :</span><strong>${formatMoney(Math.abs(owed))} ${esc(d.currency)}
        ${owed > 0 ? '(dû par la société)' : owed < 0 ? '(dû à la société)' : ''}</strong></div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Référence</th><th>Note</th><th class="r">Montant</th><th class="r">Solde</th></tr></thead>
      <tbody>${rows(d.entries, (e) => `
        <td>${new Date(e.created_at).toLocaleString('fr-FR')}</td>
        <td>${esc(e.type)}</td>
        <td>${esc(e.bon_reference || e.order_reference || '—')}</td>
        <td>${esc(e.note || '')}</td>
        <td class="r">${formatMoney(e.amount)}</td>
        <td class="r">${formatMoney(e.balance_after)}</td>`)}
      </tbody>
    </table>
    ${qrBlock(qr, d.person.name)}
    <div class="sign"><div>Signature</div><div>Cachet société</div></div>`;
}

const ORDER_STATUS_FR = Object.fromEntries(Object.entries(ORDER_STATUS).map(([k, v]) => [k, v.label]));

// Le bon fournisseur, complet : c'est la pièce que le fournisseur garde et sur
// laquelle on discute. Chaque marchandise y suit ses quatre états — reçue,
// confiée à un passager, arrivée en Algérie, remise au fournisseur — et le
// récapitulatif dit exactement ce qui est facturé et pourquoi.
export function orderManifestBody(d, qr) {
  const cur = d.bons?.[0]?.transport_currency || d.carriers?.[0]?.transport_currency || '';
  const money = (v) => formatMoney(v, cur);
  const dt = (v) => (v ? new Date(v).toLocaleString('fr-FR') : '—');
  const lines = d.lines || [];
  const t = d.totals || {};

  // Les quantités, par ligne et en tout. `arrived` déduit déjà les manquants.
  const sumQ = (f) => lines.reduce((a, l) => a + Number(l[f] || 0), 0);
  const q = { recu: sumQ('quantity'), confie: sumQ('allocated'), arrive: sumQ('arrived'), livre: sumQ('delivered_quantity'), reste: Number(t.unallocated || 0) };

  const lineRows = rows(lines, (l) => {
    const unit = esc(measureUnit(l));
    const amount = Number(l.unit_price || 0) * priceBasis(l);
    return `
        <td>${esc(l.designation)}</td>
        <td class="r">${money(l.unit_price)} / ${esc(priceUnit(l))}</td>
        <td class="r">${num(l.quantity)} ${unit}${Number(l.weight_kg) > 0 ? ` · ${num(l.weight_kg)} kg` : ''}</td>
        <td class="r">${num(l.allocated)}</td>
        <td class="r">${num(l.arrived)}</td>
        <td class="r">${num(l.delivered_quantity)}</td>
        <td class="r">${num(l.remaining)}</td>
        <td class="r"><strong>${money(amount)}</strong></td>`;
  });

  return `
    <div class="meta">
      <div><span class="k">Référence :</span><strong>${esc(d.reference)}</strong></div>
      <div><span class="k">Statut :</span><strong>${esc(ORDER_STATUS_FR[d.status] || d.status)}</strong></div>
      <div><span class="k">Fournisseur :</span>${esc(d.fournisseur_name)}${d.fournisseur_phone ? ` · ${esc(d.fournisseur_phone)}` : ''}</div>
      <div><span class="k">Devise :</span>${esc(cur)}</div>
      <div><span class="k">Reçu le :</span>${dt(d.created_at)}${d.created_by_name ? ` <span class="k">par</span> ${esc(d.created_by_name)}` : ''}</div>
      <div><span class="k">Remis le :</span>${dt(d.delivered_at)}</div>
      ${d.pickup_expected_on ? `<div><span class="k">Retrait prévu :</span><strong>${dayFr(d.pickup_expected_on)}</strong></div>` : ''}
      ${d.note ? `<div style="grid-column:1/-1"><span class="k">Note :</span>${esc(d.note)}</div>` : ''}
    </div>

    ${progressBlock(d.progress, 'Avancement de la marchandise')}

    <h2>Marchandises</h2>
    <table>
      <thead><tr>
        <th>Désignation</th><th class="r">Prix unitaire</th><th class="r">Reçu</th>
        <th class="r">Confié</th><th class="r">Arrivé</th><th class="r">Remis</th><th class="r">Reste en Chine</th><th class="r">Montant</th>
      </tr></thead>
      <tbody>${lineRows}</tbody>
      <tfoot><tr>
        <th>Total</th><th></th>
        <th class="r">${num(q.recu)}</th><th class="r">${num(q.confie)}</th><th class="r">${num(q.arrive)}</th>
        <th class="r">${num(q.livre)}</th><th class="r">${num(q.reste)}</th><th class="r">${money(t.goods ?? t.transport_fee)}</th>
      </tr></tfoot>
    </table>
    <p class="small">Confié : pris par un passager. Arrivé : compté au bureau d’Algérie, manquants déduits. Remis : emporté par le fournisseur.
      Reste en Chine : pas encore confié.</p>

    ${journalBlock(d.journal, { title: 'Ce qui est arrivé à la marchandise', withLine: (d.lines || []).length > 1 })}

    <div class="totals">
      Marchandises : ${money(t.goods ?? t.transport_fee)}<br>
      ${Number(t.commission) ? `Commission : ${money(t.commission)}<br>` : ''}
      ${Number(t.discount) ? `Remise : − ${money(t.discount)}<br>` : ''}
      <span class="big">À facturer au fournisseur : <strong>${money(t.billed ?? t.transport_fee)}</strong></span><br>
      ${Number(t.collected) ? `Encaissé : ${money(t.collected)}${d.pay ? ` (${num(d.pay.pct)} %)` : ''}<br>` : ''}
      ${Number(t.collected) ? `Reste dû : <strong>${money(t.due)}</strong><br>` : ''}
      ${Number(t.loss_total) ? `Valeur des manquants (portée en avoir) : ${money(t.loss_total)}<br>` : ''}
    </div>
    ${qrBlock(qr, d.reference)}
    <div class="sign"><div>Responsable Chine</div><div>Responsable Algérie</div><div>Le fournisseur</div></div>`;
}

// ── Generic table document ───────────────────────────────────────────
// Lets ANY list in the app be printed without writing a bespoke builder:
// pass the columns you already render on screen plus the rows.
//   columns: [{ key, label, align?: 'r', format?: (v, row) => string }]
export function tableDocBody({ columns, rows: data, meta = [], totals = [] }) {
  const head = columns.map((c) => `<th${c.align === 'r' ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('');
  const body = data.map((row) => `<tr>${columns.map((c) => {
    const raw = row[c.key];
    const val = c.format ? c.format(raw, row) : raw;
    return `<td${c.align === 'r' ? ' class="r"' : ''}>${esc(val == null ? '' : String(val))}</td>`;
  }).join('')}</tr>`).join('');
  return `
    ${meta.length ? `<div class="meta">${meta.map((m) => `<div><span class="k">${esc(m.label)} :</span>${esc(String(m.value ?? ''))}</div>`).join('')}</div>` : ''}
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body || `<tr><td colspan="${columns.length}">Aucune donnee</td></tr>`}</tbody>
    </table>
    ${totals.length ? `<div class="totals">${totals.map((t) => `${esc(t.label)} : <strong>${esc(String(t.value))}</strong>`).join('<br>')}</div>` : ''}
    <div class="foot">${data.length} ligne(s)</div>`;
}

// ── Bon line helpers ─────────────────────────────────────────────────
// A line is measured by quantity, weight or volume; everything printed about it
// (declared amount, shortfall, money) follows from that choice, so both the A4
// document and the thermal ticket derive it here rather than each guessing.
// Un bon passager porte la marchandise d'autant de fournisseurs qu'il veut ;
// n'en nommer qu'un désignerait le mauvais propriétaire.
const fournisseursOf = (bon) =>
  (bon.fournisseurs || []).map((f) => f.name).join(', ') || bon.fournisseur_name || '—';

// Les libellés vivent avec leurs statuts (bonStatus.js / orderStatus.js).
export const BON_STATUS_FR = Object.fromEntries(Object.entries(BON_STATUS).map(([k, v]) => [k, v.label]));
export const measureOf = (l) => (l.measure === 'poids' ? 'poids' : 'quantite'); // par quoi se multiplie le prix
// Le suivi d'une ligne se compte en QUANTITÉ ; le poids s'en déduit.
export const measureQty = (l) => Number(l.quantity) || 0;
export const measureUnit = (l) => l.unit || 'pièce';
export { priceUnit };
export const qtyFr = (v) => formatQty(v);
// « 10 carton · 25 kg » : la quantité et le poids, toujours ensemble.
export const declaredOf = (l) => {
  const w = Number(l.weight_kg) || 0;
  return `${qtyFr(measureQty(l))} ${measureUnit(l)}${w > 0 ? ` · ${qtyFr(w)} kg` : ''}`.trim();
};
export const deliveredOf = (l) => (l.received_quantity != null ? Number(l.received_quantity) : measureQty(l));
export const missingOf = (l) => Math.max(measureQty(l) - deliveredOf(l), 0);
// Le montant d'une ligne = prix × (quantité ou poids) de ce qui est arrivé.
export const lineAmount = (l) => Number(l.unit_price || 0) * pricedPart(l, deliveredOf(l));

// ── Bon passager (A4 body) ───────────────────────────────────────────
export function bonDocBody(bon, qr) {
  const cur = bon.transport_currency;
  const body = (bon.lines || []).map((l) => {
    const missing = missingOf(l);
    return `<tr>
      <td>${esc(l.designation)}</td>
      <td class="r">${esc(declaredOf(l))}</td>
      <td class="r">${formatMoney(l.unit_price, cur)} / ${esc(priceUnit(l))}</td>
      <td class="r">${formatMoney(l.missing_unit_price, cur)} / ${esc(priceUnit(l))}</td>
      <td class="r">${missing > 0 ? esc(`${qtyFr(missing)} ${measureUnit(l)} · ${qtyFr(weightShare(l, missing))} kg`) : '—'}</td>
      <td class="r">${formatMoney(lineAmount(l), cur)}</td>
    </tr>`;
  }).join('');

  return `
    <div class="meta">
      <div><span class="k">${(bon.fournisseurs || []).length > 1 ? 'Fournisseurs' : 'Fournisseur'} :</span>${esc(fournisseursOf(bon))}</div>
      <div><span class="k">Passager :</span>${esc(bon.passager_name || '—')}</div>
      <div><span class="k">Statut :</span>${esc(BON_STATUS_FR[bon.status] || bon.status)}</div>
      <div><span class="k">Créé le :</span>${new Date(bon.created_at).toLocaleString('fr-FR')}</div>
      <div><span class="k">Départ prévu :</span>${dayFr(bon.departure_planned_on)}${bon.departure_actual_on ? ` <span class="k">· réel</span> ${dayFr(bon.departure_actual_on)}` : ''}</div>
      <div><span class="k">Arrivée promise :</span><strong>${dayFr(bon.arrival_promised_on)}</strong>${bon.arrival_actual_on ? ` <span class="k">· réelle</span> ${dayFr(bon.arrival_actual_on)}` : ''}${Number(bon.days_late) > 0 ? ` <span class="k">(+${esc(bon.days_late)} j)</span>` : ''}</div>
      <div><span class="k">Aéroport :</span>${esc(bon.airport || '—')}${bon.airport_wilaya ? ` (${esc(bon.airport_wilaya)})` : ''}</div>
      <div><span class="k">Compagnie :</span>${esc(bon.airline || '—')}</div>
    </div>
    ${progressBlock(bon.progress, 'Avancement du voyage')}
    <table>
      <thead><tr><th>Désignation</th><th class="r">Quantité · poids</th><th class="r">Prix de transport</th><th class="r">Valeur du manquant</th><th class="r">Manquant</th><th class="r">Montant</th></tr></thead>
      <tbody>${body || '<tr><td colspan="6">Aucune ligne</td></tr>'}</tbody>
    </table>
    ${journalBlock(bon.journal, { title: 'Journal du voyage', describe: describeBonEvent })}
    <div class="totals">
      Frais de transport (commandé) : <strong>${formatMoney(bon.transport_fee, cur)}</strong><br>
      Manquants : ${formatMoney(bon.loss_total, cur)}<br>
      ${bon.passager_payment != null ? `Payé au passager (livré) : <strong>${formatMoney(bon.passager_payment, cur)}</strong>` : ''}
      ${bon.pay && Number(bon.pay.paid) > 0 ? `<br>Versé : ${formatMoney(bon.pay.paid, cur)} (${num(bon.pay.pct)} %) · Reste : <strong>${formatMoney(bon.pay.rest, cur)}</strong>` : ''}
    </div>
    ${qrBlock(qr, bon.reference)}
    <div class="sign"><div>Signature Fournisseur</div><div>Signature Passager</div></div>`;
}
