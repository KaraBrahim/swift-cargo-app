// Direct printing: fetch the document, render it as ESC/POS, push it to the
// printer. No browser, no print dialog, no PDF.
//
// The browser route in the client stays — it is what produces A4 and PDF, and it
// is the fallback when a desk has no printer wired to its server. This module is
// the other half: one click, paper.
import { getPool } from '../../db/pool.js';
import { MASKED_NAME, isSuperadmin } from '../../lib/visibility.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { getBonDetail } from '../bons/bons.service.js';
import { getOrderDetail } from '../orders/orders.service.js';
import * as receipt from './receipt.js';
import * as transport from './transport.js';

// Printing is a per-machine concern (each desk has its own printer on its own
// port), but it is stored server-side like the rest of the settings because each
// desk runs its own server — so "server-side" already means "this desk".
export const PRINT_DEFAULTS = {
  mode: 'navigateur',        // navigateur | reseau | windows | fichier
  imprimante: '',            // Windows queue name
  hote: '',                  // network printer host
  port: 9100,                // raw printing port, the near-universal default
  largeur: 80,               // 58 | 80 mm
  type: 'epson',             // command set
  jeu_caracteres: 'PC858_EURO', // French accents + €
  copies: 1,
  couper: true,
  tiroir: false,             // pulse the cash drawer after printing
  fichier: '',               // 'fichier' mode target
};

export async function getConfig(client = getPool()) {
  const { rows } = await client.query("SELECT value FROM app_settings WHERE key = 'impression'");
  return { ...PRINT_DEFAULTS, ...(rows[0]?.value ?? {}) };
}

async function getSociete(client = getPool()) {
  const { rows } = await client.query("SELECT value FROM app_settings WHERE key = 'societe'");
  return rows[0]?.value ?? { nom: 'Swift Cargo' };
}

export async function getStatus() {
  const cfg = await getConfig();
  const [reachability, printers] = await Promise.all([
    transport.probe(cfg),
    // Only worth listing where it means something, and it costs a PowerShell
    // launch — don't pay for it on every status poll from a network desk.
    cfg.mode === 'windows' ? transport.listWindowsPrinters() : Promise.resolve([]),
  ]);
  return {
    config: cfg,
    enabled: cfg.mode !== 'navigateur',
    ...reachability,
    printers,
  };
}

export const listPrinters = () => transport.listWindowsPrinters();

// Render + send, with the audit entry every other money-adjacent action writes.
async function emit({ admin, buffer, docName, entity, entityId, ip, cfgOverride }) {
  const cfg = cfgOverride ?? (await getConfig());
  if (cfg.mode === 'navigateur') {
    throw errors.conflict("L'impression directe n'est pas activée. Ouvrez Paramètres → Impression pour choisir une imprimante.");
  }
  const copies = Math.min(Math.max(Number(cfg.copies) || 1, 1), 5);
  let result = '';
  for (let i = 0; i < copies; i++) {
    result = await transport.send(buffer, cfg, docName);
  }
  await writeAudit(getPool(), {
    adminId: admin.id, action: 'print.direct', entity, entityId,
    details: { mode: cfg.mode, largeur: cfg.largeur, copies, cible: cfg.imprimante || cfg.hote || cfg.fichier }, ip,
  });
  return { ok: true, message: copies > 1 ? `${result} (${copies} exemplaires)` : result, copies };
}

export async function printBon({ admin, id, ip, cfgOverride }) {
  const cfg = cfgOverride ?? (await getConfig());
  const [bon, societe] = await Promise.all([getBonDetail(id), getSociete()]);
  return emit({
    admin, ip, cfgOverride: cfg, entity: 'bon', entityId: id, docName: `Bon ${bon.reference}`,
    buffer: receipt.bonReceipt({ bon, societe, cfg }),
  });
}

export async function printOrder({ admin, id, ip, cfgOverride }) {
  const cfg = cfgOverride ?? (await getConfig());
  const [order, societe] = await Promise.all([getOrderDetail(id), getSociete()]);
  return emit({
    admin, ip, cfgOverride: cfg, entity: 'order', entityId: id, docName: `Ordre ${order.reference}`,
    buffer: receipt.orderReceipt({ order, societe, cfg }),
  });
}

export async function printMovement({ admin, id, ip, cfgOverride }) {
  const cfg = cfgOverride ?? (await getConfig());
  const { rows } = await getPool().query(
    `SELECT t.*, c.label AS caisse_label, a.full_name AS admin_name, a.role AS admin_role
       FROM transactions t
       JOIN caisses c ON c.id = t.caisse_id
       JOIN admins a  ON a.id = t.admin_id
      WHERE t.id = $1`,
    [id]
  );
  const movement = rows[0];
  if (!movement) throw errors.notFound('Mouvement introuvable.');
  // A receipt is rendered to ESC/POS here, never through res.json, so the
  // response scrubber cannot reach it — mask the actor on the paper too.
  if (movement.admin_role === 'superadmin' && !isSuperadmin(admin)) {
    movement.admin_name = MASKED_NAME;
  }
  const societe = await getSociete();
  return emit({
    admin, ip, cfgOverride: cfg, entity: 'transaction', entityId: id, docName: `Recu ${id}`,
    buffer: receipt.movementReceipt({ movement, caisse: { label: movement.caisse_label }, societe, cfg }),
  });
}

// The test page takes its settings from the request, not from the database, so
// a new printer can be tried before the configuration is saved.
export async function printTest({ admin, overrides = {}, ip }) {
  const cfg = { ...(await getConfig()), ...overrides };
  if (cfg.mode === 'navigateur') {
    throw errors.conflict('Choisissez un mode d’impression (réseau, Windows ou fichier) avant de tester.');
  }
  const societe = await getSociete();
  return emit({
    admin, ip, cfgOverride: cfg, entity: 'app_setting', entityId: 'impression', docName: 'Test Swift Cargo',
    buffer: receipt.testReceipt({ societe, cfg, admin: admin.full_name || admin.username }),
  });
}
