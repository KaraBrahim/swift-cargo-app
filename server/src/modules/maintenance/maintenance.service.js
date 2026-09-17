// Maintenance des données — réservé au super-admin.
//
// Ce que la page permet : voir ce que contient la base, exporter une
// sauvegarde, supprimer par domaine (ou tout remettre à zéro), recalculer les
// projections, déconnecter tout le monde. Tout ce qui détruit exige le mot
// SUPPRIMER en confirmation, et tout est inscrit au journal d'audit.
//
// Les domaines suivent les clés étrangères, pas l'organigramme : une écriture
// de compte pointe vers un bon, un transfert vers un mouvement de caisse. On ne
// peut donc pas effacer « les bons » en gardant « l'argent » — d'où un seul
// domaine « activité », et des domaines qui en dépendent (`requires`).
import { getPool, withTx } from '../../db/pool.js';
import { runSeed } from '../../db/seed.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { replayChain } from '../caisse/caisse.service.js';
import { recomputeOrderStatus } from '../orders/orderStatus.js';

export const DOMAINS = [
  {
    key: 'activite', label: 'Activité',
    hint: 'Bons, commandes, transferts, mouvements de stock, mouvements de caisse, écritures de comptes et charges. Les soldes repartent de zéro.',
    tables: ['bon_status_history', 'bon_lines', 'bons', 'orders', 'stock_movements', 'office_transfers',
             'person_ledger', 'charges', 'conversions', 'transactions'],
    requires: [],
  },
  { key: 'people', label: 'Passagers, fournisseurs et salariés', hint: 'Le répertoire des personnes et les salariés.', tables: ['people', 'employees'], requires: ['activite'] },
  { key: 'stock', label: 'Articles et stock', hint: 'Catalogue, catégories, niveaux et inventaires.', tables: ['stock_inventory', 'stock_levels', 'stock_items', 'stock_categories'], requires: ['activite'] },
  { key: 'rates', label: 'Taux de change', hint: 'Historique des taux. Les taux de départ sont recréés.', tables: ['pair_rates', 'currency_pairs', 'exchange_rates'], requires: [] },
  { key: 'journal', label: 'Journal', hint: 'Journal d’audit, tentatives de connexion, clés d’idempotence.', tables: ['audit_log', 'login_attempts', 'idempotency_keys'], requires: [] },
  { key: 'users', label: 'Comptes utilisateurs', hint: 'Tous les comptes sauf le super-admin, avec leurs sessions.', tables: [], requires: [] },
];

const CONFIRM_WORD = 'SUPPRIMER';

// Tables présentes dans la base (les anciennes peuvent avoir disparu).
async function existingTables(db) {
  const { rows } = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  return new Set(rows.map((r) => r.tablename));
}

export async function overview() {
  const db = getPool();
  const present = await existingTables(db);
  const counts = {};
  for (const d of DOMAINS) {
    let n = 0;
    for (const t of d.tables) if (present.has(t)) n += Number((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
    if (d.key === 'users') n = Number((await db.query("SELECT count(*)::int AS n FROM admins WHERE role <> 'superadmin'")).rows[0].n);
    counts[d.key] = n;
  }
  const { rows: [size] } = await db.query('SELECT pg_size_pretty(pg_database_size(current_database())) AS size');
  const { rows: [sessions] } = await db.query('SELECT count(*)::int AS n FROM sessions WHERE expires_at > now()');
  return { domains: DOMAINS.map((d) => ({ key: d.key, label: d.label, hint: d.hint, requires: d.requires, rows: counts[d.key] })), size: size.size, sessions: sessions.n };
}

// Ferme la sélection sur ses dépendances : demander « people » implique « activite ».
function closure(keys) {
  const out = new Set();
  const add = (k) => { const d = DOMAINS.find((x) => x.key === k); if (!d || out.has(k)) return; out.add(k); d.requires.forEach(add); };
  keys.forEach(add);
  return [...out];
}

export async function purge({ admin, domains, confirm, ip }) {
  if (confirm !== CONFIRM_WORD) throw errors.validation([{ field: 'confirm', message: `Écrivez ${CONFIRM_WORD} pour confirmer.` }]);
  const keys = closure(domains);
  if (!keys.length) throw errors.validation([{ field: 'domains', message: 'Choisissez au moins un domaine.' }]);

  await withTx(async (c) => {
    const present = await existingTables(c);
    const tables = keys.flatMap((k) => DOMAINS.find((d) => d.key === k).tables).filter((t) => present.has(t));
    if (tables.length) await c.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
    if (keys.includes('activite')) {
      await c.query('UPDATE caisse_balances SET balance = 0');
      if (present.has('person_balances')) await c.query('TRUNCATE person_balances');
    }
    await writeAudit(c, { adminId: admin.id, action: 'maintenance.purge', entity: 'database', entityId: 0, details: { domains: keys }, ip });
  });
  // Les taux de départ sont recréés par le seed — qui, hors production, sème
  // aussi des comptes de démonstration. Les comptes se suppriment donc APRÈS,
  // pour qu'il ne reste que le super-admin, partout pareil.
  if (keys.includes('rates')) await runSeed();
  if (keys.includes('users')) await deleteOtherAdmins(admin);
  return { purged: keys };
}

// Supprimer les comptes sauf le super-admin.
//
// Des tables qui survivent à la purge pointent encore vers ces comptes : qui a
// modifié les paramètres, qui possède une caisse personnelle, qui a créé une
// fiche. Les supprimer tels quels, c'est une violation de clé étrangère — et
// une « erreur interne » au comptoir. On réattribue d'abord : la paternité au
// super-admin, la propriété d'une caisse à personne. La liste des colonnes
// vient du catalogue, pas d'ici : une table ajoutée demain est couverte.
async function deleteOtherAdmins(admin) {
  await withTx(async (c) => {
    const { rows: gone } = await c.query("SELECT id FROM admins WHERE role <> 'superadmin'");
    if (!gone.length) return;
    const ids = gone.map((r) => r.id);
    const { rows: [su] } = await c.query("SELECT id FROM admins WHERE role = 'superadmin' ORDER BY id LIMIT 1");
    const { rows: fks } = await c.query(`
      SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
         AND ccu.table_name = 'admins' AND tc.table_name NOT IN ('sessions', 'admins')`);
    for (const { table_name: t, column_name: col } of fks) {
      const owner = t === 'caisses' && col === 'owner_admin_id';
      await c.query(`UPDATE ${t} SET ${col} = ${owner ? 'NULL' : '$2'} WHERE ${col} = ANY($1)`, owner ? [ids] : [ids, su.id]);
    }
    await c.query('DELETE FROM sessions WHERE admin_id = ANY($1)', [ids]);
    await c.query('DELETE FROM admins WHERE id = ANY($1)', [ids]);
    await writeAudit(c, { adminId: admin.id, action: 'maintenance.delete_admins', entity: 'database', entityId: 0, details: { deleted: ids.length }, ip: null });
  });
}

// Tout, puis la base telle qu'au premier démarrage.
export async function reset({ admin, confirm, ip }) {
  return purge({ admin, domains: DOMAINS.map((d) => d.key), confirm, ip });
}

// Les projections se recalculent depuis les écritures : soldes de caisses et
// statuts de commandes. À lancer après un doute, jamais nécessaire en routine.
export async function recompute({ admin, ip }) {
  let caisses = 0, orders = 0;
  await withTx(async (c) => {
    const { rows: bal } = await c.query('SELECT caisse_id, currency_code FROM caisse_balances ORDER BY caisse_id, currency_code');
    for (const b of bal) { await replayChain(c, b.caisse_id, b.currency_code); caisses++; }
    const { rows: ord } = await c.query('SELECT id FROM orders ORDER BY id');
    for (const o of ord) { await recomputeOrderStatus(c, o.id); orders++; }
    await writeAudit(c, { adminId: admin.id, action: 'maintenance.recompute', entity: 'database', entityId: 0, details: { caisses, orders }, ip });
  });
  return { caisses, orders };
}

// Déconnecter tout le monde sauf celui qui le demande.
export async function revokeSessions({ admin, ip }) {
  const { rowCount } = await getPool().query('DELETE FROM sessions WHERE admin_id <> $1', [admin.id]);
  await writeAudit(getPool(), { adminId: admin.id, action: 'maintenance.revoke_sessions', entity: 'database', entityId: 0, details: { revoked: rowCount }, ip });
  return { revoked: rowCount };
}

// Une sauvegarde lisible : toutes les tables, en JSON. Pas les sessions ni les
// mots de passe — une sauvegarde qui circule ne doit pas ouvrir de porte.
const BACKUP_SKIP = new Set(['sessions', 'idempotency_keys', 'login_attempts']);
export async function backup() {
  const db = getPool();
  const present = [...await existingTables(db)].filter((t) => !BACKUP_SKIP.has(t)).sort();
  const out = { exported_at: new Date().toISOString(), tables: {} };
  for (const t of present) {
    const { rows } = await db.query(`SELECT * FROM ${t} ORDER BY 1`);
    out.tables[t] = t === 'admins' ? rows.map(({ password_hash, ...r }) => r) : rows;
  }
  return out;
}
