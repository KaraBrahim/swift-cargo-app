// Vide la base de son travail, garde ce qui la fait tourner.
//
// Pour repartir d'une base propre pendant les essais : tout ce qui a été saisi
// disparaît — personnes, bons, stock, caisse, comptes, journal — mais les
// utilisateurs, les devises, les caisses et les taux de change restent, donc
// l'application est immédiatement utilisable au lieu de repartir des valeurs
// d'usine.
//
//   node scripts/reset-data.js          → affiche ce qui serait effacé
//   node scripts/reset-data.js --yes    → efface
//
// Irréversible. Rien ici ne touche aux mots de passe ni aux sessions : vous
// restez connecté.
import { config } from '../src/config.js';
import { initPool, getPool, closePool } from '../src/db/pool.js';
import { startEmbeddedPg } from '../src/db/embedded.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Vidées, dans cet ordre : les enfants avant les parents. TRUNCATE ... CASCADE
// ferait le tri tout seul, mais nommer l'ordre dit à qui lit ce fichier comment
// les tables s'emboîtent.
const WIPE = [
  // Marchandise et documents
  'bon_status_history',
  'bon_lines',
  'bons',
  'orders',
  'stock_movements',
  'stock_inventory',
  'stock_levels',
  'stock_items',
  'stock_categories',
  // Argent
  'conversions',
  'office_transfers',
  'charges',
  'person_ledger',
  'person_balances',
  'transactions',
  // Personnes
  'people',
  // Traces
  'audit_log',
  'notification_cursor',
  'login_attempts',
  'sync_outbox',
];

// Gardées : les comptes de connexion, la configuration des devises et des
// caisses, et les taux de change saisis à la main.
const KEEP = ['admins', 'sessions', 'currencies', 'exchange_rates', 'currency_pairs', 'pair_rates', 'caisses', 'caisse_balances', 'app_settings'];

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const apply = process.argv.includes('--yes');
  let embedded = null;

  if (config.databaseUrl) {
    initPool(config.databaseUrl);
  } else {
    // Même base que le serveur de dev : il doit être arrêté, sinon le cluster
    // refuse un second démarrage sur le même dossier.
    embedded = await startEmbeddedPg({ dataDir: join(__dirname, '..', '.pgdata'), port: 55432, persistent: true });
    initPool(embedded.connectionString);
  }
  const db = getPool();

  const count = async (t) => {
    const { rows } = await db.query(`SELECT COUNT(*)::int n FROM ${t}`);
    return rows[0].n;
  };

  console.log(apply ? '— Effacement —' : '— Simulation (ajoutez --yes pour effacer) —');
  let total = 0;
  for (const t of WIPE) {
    const n = await count(t);
    total += n;
    if (n) console.log(`  ${t.padEnd(22)} ${n}`);
  }
  console.log(`  ${'TOTAL'.padEnd(22)} ${total} ligne(s)`);

  console.log('\n— Conservé —');
  for (const t of KEEP) console.log(`  ${t.padEnd(22)} ${await count(t)}`);

  if (apply) {
    // Une seule transaction : soit la base est propre, soit elle n'a pas bougé.
    // RESTART IDENTITY remet les compteurs à 1, donc le prochain bon repart de
    // BP-…-00001 comme sur une installation neuve.
    await db.query('BEGIN');
    await db.query(`TRUNCATE ${WIPE.join(', ')} RESTART IDENTITY CASCADE`);
    // Les références des bons suivent leurs propres séquences, pas les tables.
    await db.query("SELECT setval('bon_ref_seq', 1, false), setval('order_ref_seq', 1, false)");
    // Les soldes de caisse sont une projection : les lignes restent (une par
    // devise et par caisse) mais retombent à zéro, comme au premier jour.
    await db.query('UPDATE caisse_balances SET balance = 0');
    await db.query('COMMIT');
    console.log('\nBase vidée. Les utilisateurs, devises, caisses et taux sont intacts.');
  }

  await closePool();
  if (embedded) await embedded.stop();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('Échec :', e.message);
  try { await closePool(); } catch {}
  process.exit(1);
});
