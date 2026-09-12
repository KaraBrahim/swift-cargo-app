// Shared printing for every document in the app.
//
// Deliberately client-side: it produces the same black-on-white page a server
// PDF would, works with no network (the desks run offline), and adds no
// dependency. The browser's own "Imprimer → Enregistrer au format PDF" is the
// PDF export.
import { formatMoney } from './ui.jsx';
import { formatQty } from '../lib/format.js';

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
  .foot { margin-top:26px; border-top:1px solid #ddd; padding-top:8px; font-size:11px; color:#666; }
  .sign { margin-top:44px; display:flex; justify-content:space-between; font-size:13px; }
  .sign div { border-top:1px solid #999; padding-top:6px; width:40%; text-align:center; }
  /* Le code qui ramène ce papier dans le système, avec sa référence en clair
     dessous : un QR abîmé doit rester retapable. */
  .qr { margin-top:22px; text-align:center; }
  .qr img { width:104px; height:104px; image-rendering:pixelated; }
  .qr div { margin-top:4px; font-size:11px; letter-spacing:1px; color:#666; }
  /* The app's own layout must never clip a multi-page document. */
  @media print { body { margin:12mm; } .no-print { display:none !important; }
    html, body { overflow:visible !important; height:auto !important; } }
`;

// Le bloc scannable. Rien si la page n'a pas (encore) produit l'image : un
// document sans QR reste un document valide, il se retrouve à la référence.
export const qrBlock = (qr, reference) =>
  (qr ? `<div class="qr"><img src="${qr}" alt=""><div>${esc(reference || '')}</div></div>` : '');

// Open a standalone window with a finished document and trigger the print dialog.
export function printWindowHtml({ title, societe, docTitle, subtitle, body }) {
  const s = societe ?? {};
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>
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

export function orderManifestBody(d, qr) {
  return `
    <div class="meta">
      <div><span class="k">Bon fournisseur :</span>${esc(d.reference)}</div>
      <div><span class="k">Fournisseur :</span>${esc(d.fournisseur_name)}</div>
      <div><span class="k">Statut :</span>${esc(d.status)}</div>
      <div><span class="k">Créé le :</span>${new Date(d.created_at).toLocaleString('fr-FR')}</div>
    </div>
    <table>
      <thead><tr><th>Bon passager</th><th>Passager</th><th class="r">Lignes</th><th class="r">Frais</th><th class="r">Pertes</th><th>Statut</th></tr></thead>
      <tbody>${rows(d.bons, (b) => `
        <td>${esc(b.reference)}</td>
        <td>${esc(b.passager_name || '—')}</td>
        <td class="r">${num(b.line_count)}</td>
        <td class="r">${formatMoney(b.transport_fee)}</td>
        <td class="r">${formatMoney(b.loss_total)}</td>
        <td>${esc(b.status)}</td>`)}
      </tbody>
    </table>
    <div class="totals">
      Marchandises : ${formatMoney(d.totals.goods ?? d.totals.transport_fee)}<br>
      ${Number(d.totals.commission) ? `Commission : ${formatMoney(d.totals.commission)}<br>` : ''}
      ${Number(d.totals.discount) ? `Remise : − ${formatMoney(d.totals.discount)}<br>` : ''}
      À facturer : <strong>${formatMoney(d.totals.billed ?? d.totals.transport_fee)}</strong><br>
      Total pertes : ${formatMoney(d.totals.loss_total)}
    </div>
    ${qrBlock(qr, d.reference)}
    <div class="sign"><div>Responsable Chine</div><div>Responsable Algérie</div></div>`;
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

export const BON_STATUS_FR = { cree: 'Créé', en_transit: 'En transit', arrive: 'Arrivé', regle: 'Réglé' };
export const measureOf = (l) =>
  l.measure || (Number(l.weight_kg) > 0 ? 'poids' : Number(l.cbm) > 0 ? 'cbm' : 'quantite');
export const measureQty = (l) => {
  const m = measureOf(l);
  return Number(m === 'poids' ? l.weight_kg : m === 'cbm' ? l.cbm : l.quantity) || 0;
};
export const measureUnit = (l) => {
  const m = measureOf(l);
  return m === 'poids' ? 'kg' : m === 'cbm' ? 'm³' : l.unit || 'u';
};
export const qtyFr = (v) => formatQty(v);
export const declaredOf = (l) => `${qtyFr(measureQty(l))} ${measureUnit(l)}`.trim();
export const deliveredOf = (l) => (l.received_quantity != null ? Number(l.received_quantity) : measureQty(l));
export const missingOf = (l) => Math.max(measureQty(l) - deliveredOf(l), 0);
export const lineAmount = (l) => Number(l.unit_price || 0) * deliveredOf(l);

// ── Bon passager (A4 body) ───────────────────────────────────────────
export function bonDocBody(bon, qr) {
  const cur = bon.transport_currency;
  const body = (bon.lines || []).map((l) => {
    const missing = missingOf(l);
    return `<tr>
      <td>${esc(l.designation)}</td>
      <td class="r">${formatMoney(l.unit_price, cur)} / ${esc(measureUnit(l))}</td>
      <td class="r">${formatMoney(l.missing_unit_price, cur)} / ${esc(measureUnit(l))}</td>
      <td class="r">${esc(declaredOf(l))}</td>
      <td class="r">${missing > 0 ? esc(`${qtyFr(missing)} ${measureUnit(l)}`) : '—'}</td>
      <td class="r">${formatMoney(lineAmount(l), cur)}</td>
    </tr>`;
  }).join('');

  return `
    <div class="meta">
      <div><span class="k">${(bon.fournisseurs || []).length > 1 ? 'Fournisseurs' : 'Fournisseur'} :</span>${esc(fournisseursOf(bon))}</div>
      <div><span class="k">Passager :</span>${esc(bon.passager_name || '—')}</div>
      <div><span class="k">Statut :</span>${esc(BON_STATUS_FR[bon.status] || bon.status)}</div>
      <div><span class="k">Créé le :</span>${new Date(bon.created_at).toLocaleString('fr-FR')}</div>
      <div><span class="k">Arrivée :</span>${bon.arrived_at ? new Date(bon.arrived_at).toLocaleString('fr-FR') : '—'}</div>
    </div>
    <table>
      <thead><tr><th>Désignation</th><th class="r">Prix de transport</th><th class="r">Valeur du manquant</th><th class="r">Quantité</th><th class="r">Manquant</th><th class="r">Montant</th></tr></thead>
      <tbody>${body || '<tr><td colspan="6">Aucune ligne</td></tr>'}</tbody>
    </table>
    <div class="totals">
      Frais de transport (commandé) : <strong>${formatMoney(bon.transport_fee, cur)}</strong><br>
      Manquants : ${formatMoney(bon.loss_total, cur)}<br>
      ${bon.passager_payment != null ? `Payé au passager (livré) : <strong>${formatMoney(bon.passager_payment, cur)}</strong>` : ''}
    </div>
    ${qrBlock(qr, bon.reference)}
    <div class="sign"><div>Signature Fournisseur</div><div>Signature Passager</div></div>`;
}
