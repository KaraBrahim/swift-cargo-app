// Boot sequence: connect (embedded PG if no DATABASE_URL) -> migrate -> seed ->
// listen. Fails fast and loudly if any step throws.
import { config } from './config.js';
import { ensureConnection } from './db/connect.js';
import { runMigrations } from './db/migrate.js';
import { runSeed } from './db/seed.js';
import { applyIdRanges } from './db/nodeSetup.js';
import { closePool } from './db/pool.js';
import { startSyncWorker } from './modules/sync/sync.service.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';

// Secrets that MUST come from the environment in production.
//
// This refuses to start rather than warning. A warning is the wrong tool here:
// nobody reads the log of a server that came up fine, and the thing being
// warned about is the front door of a cash ledger. In production the seed
// passwords have no default at all (config.js), so booting without them would
// create the super-admin with an empty password.
function assertSecrets() {
  const missing = [];
  if (!process.env.SUPERADMIN_PASSWORD) missing.push('SUPERADMIN_PASSWORD');
  if (missing.length) {
    throw new Error(
      `Démarrage refusé — variable(s) d'environnement manquante(s) : ${missing.join(', ')}. ` +
        "Le code ne contient aucun mot de passe par défaut. " +
        'En développement : copiez server/.env.example vers server/.env. ' +
        "En production : définissez-les dans l'environnement du serveur."
    );
  }
  if (!config.isProduction) return;

  // Not fatal: with no token the /sync/* routes refuse everything (see
  // sync.routes.js), so the ledger stays closed — sync is simply off.
  if (!config.nodeToken) {
    logger.warn(
      "NODE_TOKEN non défini : la synchronisation multi-sites est DÉSACTIVÉE — les routes /sync/* " +
        'refusent toutes les requêtes. Définissez NODE_TOKEN des deux côtés pour l\'activer.'
    );
  }
}

async function main() {
  // Before anything touches the database: the seed depends on these.
  assertSecrets();

  const conn = await ensureConnection();
  await runMigrations();
  await runSeed();
  await applyIdRanges();
  startSyncWorker();

  if (config.isProduction && !config.cookieSecure) {
    logger.warn(
      'SÉCURITÉ — COOKIE_SECURE=0 : le jeton de session et les mots de passe circulent en clair. ' +
        "À n'utiliser que sur un réseau local de confiance, jamais via Internet sans HTTPS."
    );
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`Swift Cargo API on http://localhost:${config.port} (${config.nodeEnv})`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down…`);
    server.close();
    await closePool();
    await conn.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', err?.stack || err);
  process.exit(1);
});
