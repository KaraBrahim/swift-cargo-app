// Thermal-printer documents (receipt roll), as opposed to the A4 documents in
// printDocument.js.
//
// A thermal printer is not a page printer: the paper is a continuous roll 80mm
// (or 58mm) wide with no fixed height, and the head is monochrome and low-DPI.
// So this stylesheet is deliberately the opposite of the A4 one:
//   * `@page { size: <width> auto }` — ONE continuous page, never paginated;
//   * no borders, no shading, no colour — box rules print as heavy black bars
//     and grey fills come out as muddy dither, so separators are dashed rules;
//   * bold sans-serif at a large size, because low DPI eats thin strokes;
//   * the reference is printed big — it is the one thing people read across a
//     counter.
//
// The same window is also how you get a PDF: "Imprimer → Enregistrer au format
// PDF" produces a single long page matching the roll.
import {
  esc, BON_STATUS_FR, measureUnit, qtyFr,
  declaredOf, missingOf, lineAmount,
} from './printDocument.js';
import { formatMoney } from '../lib/format.js';

const money = (v, c) =>
  formatMoney(v ?? 0, c || undefined);
const dt = (v) => (v ? new Date(v).toLocaleString('fr-FR') : '—');

export const TICKET_WIDTHS = [
  { key: '80', label: '80 mm (standard)', mm: 80 },
  { key: '58', label: '58 mm (compact)', mm: 58 },
];

export const ticketCss = (mm = 80) => `
  @page { size: ${mm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    width: ${mm}mm; padding: ${mm >= 80 ? 4 : 3}mm;
    font-family: Arial, Helvetica, sans-serif; color: #000;
    font-size: ${mm >= 80 ? 12.5 : 11}px; line-height: 1.35; font-weight: 600;
    -webkit-font-smoothing: none;
  }
  .c { text-align: center; }
  .brand { font-size: ${mm >= 80 ? 17 : 15}px; font-weight: 800; letter-spacing: 1.5px; }
  .sub { font-weight: 400; font-size: ${mm >= 80 ? 11 : 10}px; }
  .doc { margin-top: 3mm; font-size: ${mm >= 80 ? 13 : 11.5}px; font-weight: 800; text-transform: uppercase; }
  /* The reference is the line read across a counter — keep it oversized. */
  .ref { font-size: ${mm >= 80 ? 20 : 17}px; font-weight: 800; letter-spacing: 1px; margin-top: 1mm; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
  .row { display: flex; justify-content: space-between; gap: 3mm; }
  .row .k { font-weight: 400; }
  .row .v { text-align: right; font-weight: 700; }
  .item { margin: 1.6mm 0; }
  .item .name { font-weight: 700; }
  .tot { font-size: ${mm >= 80 ? 15 : 13}px; font-weight: 800; }
  .sign { margin-top: 7mm; }
  .sign .line { border-top: 1px solid #000; margin-top: 8mm; padding-top: 1mm; font-weight: 400; font-size: 10px; }
  .foot { margin-top: 4mm; font-weight: 400; font-size: 10px; }
  @media print { .no-print { display: none !important; } }
`;

// Open a roll-sized window and fire the print dialog.
export function openTicketWindow({ title, mm = 80, body }) {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <title>${esc(title)}</title><style>${ticketCss(mm)}</style></head>
    <body>${body}<script>window.onload=()=>{window.print()};<\/script></body></html>`;
  const w = window.open('', '_blank', 'width=420,height=800');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

const header = (societe, docLabel, ref) => {
  const s = societe ?? {};
  return `
    <div class="c">
      <div class="brand">${esc(s.nom || 'SWIFT CARGO')}</div>
      ${s.adresse ? `<div class="sub">${esc(s.adresse)}</div>` : ''}
      ${s.telephone ? `<div class="sub">Tél. ${esc(s.telephone)}</div>` : ''}
      <div class="doc">${esc(docLabel)}</div>
      ${ref ? `<div class="ref">${esc(ref)}</div>` : ''}
    </div><hr>`;
};

const footer = (societe) => `
  <hr>
  <div class="c foot">
    ${esc((societe ?? {}).pied_de_page || 'Merci de votre confiance')}<br>
    Imprimé le ${new Date().toLocaleString('fr-FR')}
  </div>`;

const line = (k, v) =>
  `<div class="row"><span class="k">${esc(k)}</span><span class="v">${esc(String(v))}</span></div>`;

// ── Bon passager — the everyday counter ticket ───────────────────────
export function bonTicket(bon, societe) {
  const cur = bon.transport_currency;
  const items = (bon.lines || []).map((l) => {
    const missing = missingOf(l);
    return `
    <div class="item">
      <div class="name">${esc(l.designation)}</div>
      <div class="row">
        <span class="k">${esc(declaredOf(l))}${Number(l.unit_price) ? ` × ${money(l.unit_price)}` : ''}</span>
        <span class="v">${esc(money(lineAmount(l), cur))}</span>
      </div>
      ${missing > 0 ? `<div class="row"><span class="k">Manquant</span><span class="v">${esc(qtyFr(missing))} ${esc(measureUnit(l))}</span></div>` : ''}
    </div>`;
  }).join('');

  return `
    ${header(societe, 'Bon passager', bon.reference)}
    ${line((bon.fournisseurs || []).length > 1 ? 'Fournisseurs' : 'Fournisseur',
      (bon.fournisseurs || []).map((f) => f.name).join(', ') || bon.fournisseur_name || '—')}
    ${line('Passager', bon.passager_name || '—')}
    ${line('Statut', BON_STATUS_FR[bon.status] || bon.status)}
    ${line('Créé le', dt(bon.created_at))}
    ${bon.arrived_at ? line('Arrivé le', dt(bon.arrived_at)) : ''}
    <hr>
    <div class="c sub">MARCHANDISE</div>
    ${items || '<div class="c sub">Aucune ligne</div>'}
    <hr>
    ${line('Frais de transport', money(bon.transport_fee, cur))}
    ${Number(bon.loss_total) ? line('Manquants', money(bon.loss_total, cur)) : ''}
    ${bon.passager_payment != null
      ? `<div class="row tot"><span>PAYÉ AU PASSAGER</span><span>${esc(money(bon.passager_payment, cur))}</span></div>`
      : ''}
    <div class="sign">
      <div class="line">Signature fournisseur</div>
      <div class="line">Signature passager</div>
    </div>
    ${footer(societe)}`;
}

// ── Bon fournisseur / manifest — one entry per child bon ─────────────
export function orderTicket(order, societe) {
  const items = (order.bons || []).map((b) => `
    <div class="item">
      <div class="name">${esc(b.reference)}</div>
      <div class="row">
        <span class="k">${esc(b.passager_name || '—')}</span>
        <span class="v">${money(b.transport_fee)}</span>
      </div>
    </div>`).join('');
  return `
    ${header(societe, 'Bon fournisseur', order.reference)}
    ${line('Fournisseur', order.fournisseur_name || '—')}
    ${line('Statut', order.status)}
    ${line('Créé le', dt(order.created_at))}
    <hr>
    <div class="c sub">BONS PASSAGERS (${(order.bons || []).length})</div>
    ${items || '<div class="c sub">Aucun bon</div>'}
    <hr>
    <div class="row tot"><span>TOTAL FRAIS</span><span>${esc(money(order.totals?.transport_fee))}</span></div>
    ${Number(order.totals?.loss_total) ? line('Total pertes', money(order.totals.loss_total)) : ''}
    <div class="sign"><div class="line">Responsable</div></div>
    ${footer(societe)}`;
}

// ── Caisse receipt — proof for a single cash movement ────────────────
export function movementTicket({ movement, caisse, societe }) {
  const m = movement;
  const isIn = m.direction === 'in';
  return `
    ${header(societe, isIn ? 'Reçu d’encaissement' : 'Reçu de paiement', m.id ? `N° ${m.id}` : '')}
    ${line('Caisse', caisse?.label || '—')}
    ${line('Date', dt(m.created_at))}
    ${line('Type', m.type)}
    ${m.note ? line('Note', m.note) : ''}
    ${m.admin_name ? line('Agent', m.admin_name) : ''}
    <hr>
    <div class="row tot">
      <span>${isIn ? 'REÇU' : 'PAYÉ'}</span>
      <span>${esc(money(m.amount, m.currency_code))}</span>
    </div>
    ${line('Solde après', money(m.balance_after, m.currency_code))}
    <div class="sign"><div class="line">Signature</div></div>
    ${footer(societe)}`;
}

// ── Generic list ticket — makes any table printable on the roll ──────
export function listTicket({ docLabel, subtitle, columns, rows, totals, societe }) {
  const body = rows.map((r) => `
    <div class="item">
      <div class="name">${esc(r[columns[0].key] ?? '')}</div>
      ${columns.slice(1).map((c) => {
        const v = r[c.key];
        return v == null || v === ''
          ? ''
          : `<div class="row"><span class="k">${esc(c.label)}</span><span class="v">${esc(String(v))}</span></div>`;
      }).join('')}
    </div>`).join('');
  return `
    ${header(societe, docLabel, '')}
    ${subtitle ? `<div class="c sub">${esc(subtitle)}</div><hr>` : ''}
    ${body || '<div class="c sub">Aucune donnée</div>'}
    ${totals?.length
      ? `<hr>${totals.map((t) => `<div class="row tot"><span>${esc(t.label)}</span><span>${esc(String(t.value))}</span></div>`).join('')}`
      : ''}
    ${footer(societe)}`;
}
