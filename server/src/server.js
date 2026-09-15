// Boot sequence: connect (embedded PG if no DATABASE_URL) -> migrate -> seed ->
// listen. Fails fast and loudly if any step throws.
import { config } from './config.js';
import { ensureConnection } from './db/connect.js';
import { runMigrations } from './db/migrate.js';
import { runSeed } from './db/seed.js';
import { closePool } from './db/pool.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';


function assertSecrets() {
  const missing = [];
  if (!process.env.SUPERADMIN_PASSWORD) missing.push('SUPERADMIN_PASSWORD');
  if (missing.length) {
    const err = new Error(
      `Démarrage refusé — variable(s) d'environnement manquante(s) : ${missing.join(', ')}. ` +
        "Le code ne contient aucun mot de passe par défaut. " +
        'En développement : copiez server/.env.example vers server/.env. ' +
        "En production : définissez-les dans l'environnement du serveur."
    );
    err.userFacing = true;
    throw err;
  }
}

async function main() {
  // Before anything touches the database: the seed depends on these.
  assertSecrets();

  const conn = await ensureConnection();
  await runMigrations();
  await runSeed();

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
  // A stack trace helps with a real crash and only buries the point when the
  // problem is something the operator is meant to read and act on.
  if (err?.userFacing) logger.error(err.message);
  else logger.error('Fatal startup error', err?.stack || err);
  process.exit(1);
});
