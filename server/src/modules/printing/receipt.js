// Receipt content, expressed as ESC/POS.
//
// This is the *direct* counterpart of the browser tickets in
// client/src/components/printTicket.js: same documents, same wording, same
// figures — but rendered as printer commands rather than as HTML, so the paper
// comes out of the printer without a browser, a print dialog or a PDF in
// between.
//
// Everything goes through node-thermal-printer, which knows the command set of
// each printer family (Epson, Star…) and does the character-set encoding. We
// build the buffer here and hand it to a transport in transport.js.
import { ThermalPrinter, PrinterTypes, CharacterSet, BreakLine } from 'node-thermal-printer';

// Characters per line at font A. This is the one number the whole layout
// depends on: leftRight() pads against it, so a wrong width makes every
// right-hand column land in the wrong place.
export const WIDTH_CHARS = { 58: 32, 80: 48 };

const TYPES = { epson: PrinterTypes.EPSON, star: PrinterTypes.STAR, tanca: PrinterTypes.TANCA, daruma: PrinterTypes.DARUMA, brother: PrinterTypes.BROTHER };

// Deliberately not toLocaleString(): recent ICU emits a narrow no-break space as
// the group separator, which has no place in the printer's code page and comes
// out as '?'. A plain space always survives.
//
// A space groups the digits and a DOT marks the decimals — the same rule the
// screen follows (client/src/lib/format.js). A receipt that reads 8 000,00
// beside a screen reading 8 000.00 invites someone to wonder which is right.
const money = (v, c) => {
  const n = Number(v ?? 0);
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '-' : ''}${grouped}.${dec}${c ? ' ' + c : ''}`;
};
const qty = (v) => {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};
const dt = (v) => {
  if (!v) return '-';
  const d = new Date(v);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const STATUS_FR = { cree: 'Cree', en_transit: 'En transit', arrive: 'Arrive', regle: 'Regle' };

// Line semantics, identical to the client helpers in printDocument.js: a line is
// quantified by ONE measure, and what is charged is what was actually received.
const measureOf = (l) => l.measure || (Number(l.weight_kg) > 0 ? 'poids' : Number(l.cbm) > 0 ? 'cbm' : 'quantite');
const measureQty = (l) => Number((measureOf(l) === 'poids' ? l.weight_kg : measureOf(l) === 'cbm' ? l.cbm : l.quantity) ?? 0);
const measureUnit = (l) => (measureOf(l) === 'poids' ? 'kg' : measureOf(l) === 'cbm' ? 'm3' : l.unit || 'u');
const deliveredOf = (l) => (l.received_quantity != null ? Number(l.received_quantity) : measureQty(l));
const missingOf = (l) => Math.max(measureQty(l) - deliveredOf(l), 0);
const lineAmount = (l) => Number(l.unit_price || 0) * deliveredOf(l);

export function createPrinter(cfg) {
  return new ThermalPrinter({
    type: TYPES[cfg.type] || PrinterTypes.EPSON,
    width: WIDTH_CHARS[cfg.largeur] || WIDTH_CHARS[80],
    characterSet: CharacterSet[cfg.jeu_caracteres] || CharacterSet.PC858_EURO,
    // Accented French must survive; the code page above is what carries it.
    removeSpecialCharacters: false,
    lineCharacter: '-',
    breakLine: BreakLine.WORD,
  });
}

function header(p, societe, docLabel, ref) {
  const s = societe ?? {};
  p.alignCenter();
  p.bold(true);
  p.setTextDoubleHeight();
  p.println(s.nom || 'SWIFT CARGO');
  p.setTextNormal();
  p.bold(false);
  if (s.adresse) p.println(s.adresse);
  if (s.telephone) p.println(`Tel. ${s.telephone}`);
  p.newLine();
  p.bold(true);
  p.println(docLabel.toUpperCase());
  if (ref) {
    // The reference is the one line read across a counter — print it big.
    p.setTextDoubleHeight();
    p.println(ref);
    p.setTextNormal();
  }
  p.bold(false);
  p.alignLeft();
  p.drawLine();
}

function footer(p, societe, cfg) {
  p.drawLine();
  p.alignCenter();
  p.println((societe ?? {}).pied_de_page || 'Merci de votre confiance');
  p.println(`Imprime le ${dt(new Date())}`);
  p.alignLeft();
  p.newLine();
  if (cfg.tiroir) p.openCashDrawer();
  // A printer with no cutter ignores the command, so this is safe to send; the
  // vertical feed before it is what pushes the last line past the tear bar.
  if (cfg.couper) p.cut();
  else { p.newLine(); p.newLine(); }
}

// leftRight() pads between the two halves — but when they add up to more than
// the line it simply butts them together, and on a 32-character roll
// « FournisseurGuangzhou Trading Co. » is the result. The right-hand side is
// always a figure and must stay intact, so the label is what gives way.
function pair(p, left, right) {
  const r = String(right ?? '-');
  const room = p.getWidth() - r.length - 1;
  p.leftRight(room > 0 ? String(left).slice(0, room) : String(left), r);
}

const kv = (p, k, v) => pair(p, k, String(v ?? '-'));

function signatures(p, labels) {
  p.newLine();
  for (const label of labels) {
    p.newLine();
    p.drawLine();
    p.println(label);
  }
}

// ── Bon passager — the everyday counter ticket ───────────────────────
export function bonReceipt({ bon, societe, cfg }) {
  const p = createPrinter(cfg);
  const cur = bon.transport_currency;
  header(p, societe, 'Bon passager', bon.reference);

  // Un bon passager peut porter la marchandise de plusieurs fournisseurs : on
  // les nomme tous, sinon le ticket désigne le mauvais propriétaire.
  const fournisseurs = (bon.fournisseurs || []).map((f) => f.name).join(', ');
  kv(p, fournisseurs.includes(',') ? 'Fournisseurs' : 'Fournisseur', fournisseurs || bon.fournisseur_name || '-');
  kv(p, 'Passager', bon.passager_name);
  kv(p, 'Statut', STATUS_FR[bon.status] || bon.status);
  kv(p, 'Cree le', dt(bon.created_at));
  if (bon.arrived_at) kv(p, 'Arrive le', dt(bon.arrived_at));
  p.drawLine();

  p.alignCenter();
  p.println('MARCHANDISE');
  p.alignLeft();
  for (const l of bon.lines || []) {
    p.bold(true);
    p.println(l.designation);
    p.bold(false);
    const left = `${qty(deliveredOf(l))} ${measureUnit(l)}${Number(l.unit_price) ? ` x ${money(l.unit_price)}` : ''}`;
    pair(p, left, money(lineAmount(l)));
    const missing = missingOf(l);
    if (missing > 0) pair(p, '  Manquant', `${qty(missing)} ${measureUnit(l)}`);
  }
  p.drawLine();

  kv(p, 'Frais de transport', money(bon.transport_fee, cur));
  if (Number(bon.loss_total)) kv(p, 'Manquants', money(bon.loss_total, cur));
  if (bon.passager_payment != null) {
    p.bold(true);
    p.setTextDoubleHeight();
    pair(p, 'PAYE', money(bon.passager_payment, cur));
    p.setTextNormal();
    p.bold(false);
  }
  signatures(p, ['Signature fournisseur', 'Signature passager']);
  footer(p, societe, cfg);
  return p.getBuffer();
}

// ── Bon fournisseur / manifest — one entry per child bon ─────────────
export function orderReceipt({ order, societe, cfg }) {
  const p = createPrinter(cfg);
  header(p, societe, 'Bon fournisseur', order.reference);

  kv(p, 'Fournisseur', order.fournisseur_name);
  kv(p, 'Statut', order.status);
  kv(p, 'Cree le', dt(order.created_at));
  p.drawLine();

  const bons = order.bons || [];
  p.alignCenter();
  p.println(`BONS PASSAGERS (${bons.length})`);
  p.alignLeft();
  for (const b of bons) {
    p.bold(true);
    p.println(b.reference);
    p.bold(false);
    pair(p, `  ${b.passager_name || '-'}`, money(b.transport_fee));
  }
  p.drawLine();
  p.bold(true);
  pair(p, 'TOTAL FRAIS', money(order.totals?.transport_fee));
  p.bold(false);
  if (Number(order.totals?.loss_total)) kv(p, 'Total pertes', money(order.totals.loss_total));

  signatures(p, ['Responsable']);
  footer(p, societe, cfg);
  return p.getBuffer();
}

// ── Caisse receipt — proof for a single cash movement ────────────────
export function movementReceipt({ movement: m, caisse, societe, cfg }) {
  const p = createPrinter(cfg);
  const isIn = m.direction === 'in';
  header(p, societe, isIn ? "Recu d'encaissement" : 'Recu de paiement', m.id ? `N ${m.id}` : '');

  kv(p, 'Caisse', caisse?.label);
  kv(p, 'Date', dt(m.created_at));
  kv(p, 'Type', m.type);
  if (m.note) kv(p, 'Note', m.note);
  if (m.admin_name) kv(p, 'Agent', m.admin_name);
  p.drawLine();

  p.bold(true);
  p.setTextDoubleHeight();
  pair(p, isIn ? 'RECU' : 'PAYE', money(m.amount, m.currency_code));
  p.setTextNormal();
  p.bold(false);
  kv(p, 'Solde apres', money(m.balance_after, m.currency_code));

  signatures(p, ['Signature']);
  footer(p, societe, cfg);
  return p.getBuffer();
}

// ── Test page — proves the whole chain end to end ────────────────────
// Prints the settings it was produced with, so a wrong width or a wrong code
// page is visible on the paper instead of having to be guessed at.
export function testReceipt({ societe, cfg, admin }) {
  const p = createPrinter(cfg);
  header(p, societe, "Test d'impression", '');

  kv(p, 'Mode', cfg.mode);
  kv(p, 'Destination', cfg.mode === 'reseau' ? `${cfg.hote}:${cfg.port}` : cfg.mode === 'windows' ? cfg.imprimante : cfg.fichier);
  kv(p, 'Largeur', `${cfg.largeur} mm (${WIDTH_CHARS[cfg.largeur] || 48} car.)`);
  kv(p, 'Modele', cfg.type);
  kv(p, 'Jeu de car.', cfg.jeu_caracteres);
  kv(p, 'Poste', admin || '-');
  kv(p, 'Date', dt(new Date()));
  p.drawLine();

  // If the code page is wrong these come out as '?' or as the wrong glyphs —
  // which is exactly what this line is for.
  p.println('Accents : é è à ç ù ô €');
  p.bold(true); p.println('Gras'); p.bold(false);
  p.setTextDoubleHeight(); p.println('Double hauteur'); p.setTextNormal();
  p.alignCenter(); p.println('Centre'); p.alignRight(); p.println('Droite'); p.alignLeft();
  p.drawLine();
  // A full-width ruler: the last digit must land on the right edge.
  p.println(Array.from({ length: p.getWidth() }, (_, i) => String((i + 1) % 10)).join(''));

  footer(p, societe, cfg);
  return p.getBuffer();
}
