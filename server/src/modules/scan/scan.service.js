// Le papier revient dans le système.
//
// Un bon est un contrat imprimé remis en Chine et présenté au comptoir en
// Algérie. Le QR qu'il porte ne dit qu'une chose — le type de pièce et son uuid
// — et c'est ici qu'on la retrouve : quelle fiche ouvrir, et quelle action on
// attend à ce stade. Rien n'est modifié par le scan lui-même ; un scan par
// erreur ne doit jamais déplacer un bon.

import { getPool } from '../../db/pool.js';
import { AppError, errors } from '../../lib/AppError.js';
import { parseScan } from '../../lib/scanCode.js';

// L'action attendue quand ce bon-là arrive sous la douchette. Elle suit le
// statut, parce que c'est le statut qui dit ce qu'il reste à faire.
function nextForBon(bon) {
  if (bon.order_id != null) return null;           // bon fournisseur : rien d'automatique
  switch (bon.status) {
    case 'cree':
      return { action: 'advance', label: 'Marquer « En transit »' };
    case 'en_transit':
      return { action: 'advance', label: 'Marquer « Arrivé »' };
    case 'arrive':
      return { action: 'reconcile', label: 'Saisir les manquants' };
    case 'regle':
      return bon.passager_payment != null && Number(bon.passager_payment) > 0
        ? { action: 'pay', label: 'Payer le passager' }
        : null;
    default:
      return null;
  }
}

async function findBon(uuid) {
  const { rows } = await getPool().query(
    `SELECT b.id, b.reference, b.status, b.order_id, b.passager_payment,
            o.id AS order_id_ref, o.reference AS order_reference,
            p.name AS passager_name
       FROM bons b
       LEFT JOIN orders o ON o.id = b.order_id
       LEFT JOIN people p ON p.id = b.passager_id
      WHERE b.uuid = $1`,
    [uuid]
  );
  const b = rows[0];
  if (!b) return null;
  // Un bon fournisseur n'a pas de fiche à lui : c'est son ordre qu'on ouvre,
  // celui que le fournisseur a signé.
  return b.order_id != null
    ? {
        kind: 'order', id: b.order_id, reference: b.order_reference,
        path: `/bons-fournisseur/${b.order_id}`, label: 'Bon fournisseur',
        status: b.status, next: null,
      }
    : {
        kind: 'bon', id: b.id, reference: b.reference,
        path: `/bons-passager/${b.id}`, label: 'Bon passager',
        status: b.status, subtitle: b.passager_name || null, next: nextForBon(b),
      };
}

async function findOrder(uuid) {
  const { rows } = await getPool().query(
    `SELECT o.id, o.reference, o.status, f.name AS fournisseur_name
       FROM orders o JOIN people f ON f.id = o.fournisseur_id
      WHERE o.uuid = $1`,
    [uuid]
  );
  const o = rows[0];
  if (!o) return null;
  return {
    kind: 'order', id: o.id, reference: o.reference, path: `/bons-fournisseur/${o.id}`,
    label: 'Bon fournisseur', status: o.status, subtitle: o.fournisseur_name, next: null,
  };
}

async function findPerson(uuid) {
  const { rows } = await getPool().query(
    'SELECT id, name, phone, is_fournisseur, is_passager FROM people WHERE uuid = $1', [uuid]
  );
  const p = rows[0];
  if (!p) return null;
  const roles = [p.is_fournisseur && 'Fournisseur', p.is_passager && 'Passager'].filter(Boolean);
  return {
    kind: 'person', id: p.id, reference: p.name, path: `/personnes/${p.id}`,
    label: roles.join(' · ') || 'Fiche', subtitle: p.phone || null, next: null,
  };
}

async function findTransaction(uuid) {
  const { rows } = await getPool().query(
    `SELECT t.id, t.caisse_id, t.amount, t.currency_code, c.label AS caisse_label
       FROM transactions t JOIN caisses c ON c.id = t.caisse_id
      WHERE t.uuid = $1`,
    [uuid]
  );
  const t = rows[0];
  if (!t) return null;
  return {
    kind: 'transaction', id: t.id, reference: `#${t.id}`, path: `/caisses/${t.caisse_id}`,
    label: 'Mouvement de caisse', subtitle: t.caisse_label, next: null,
  };
}

const FINDERS = { bon: findBon, order: findOrder, person: findPerson, transaction: findTransaction };

export async function resolveScan(code) {
  const parsed = parseScan(code);
  // Un QR abime ou un code venu d'ailleurs : le dire en clair. « Requete
  // invalide » ne se comprend pas debout devant un comptoir.
  if (!parsed) {
    throw new AppError('SCAN_UNREADABLE', 'Code illisible : ce n’est pas un code Swift Cargo.', { status: 400 });
  }
  const hit = await FINDERS[parsed.kind](parsed.uuid);
  if (!hit) throw errors.notFound('Ce code ne correspond à aucune pièce enregistrée ici.');
  return hit;
}
