// Resolves how the app talks to Postgres: real DATABASE_URL if given, otherwise
// boot an embedded instance. Returns a { connectionString, stop } handle and
// initialises the shared pool. Used by the server and by CLI scripts.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { initPool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = join(__dirname, '..', '..', '.pgdata');

let handle = null;

export async function ensureConnection(opts = {}) {
  if (handle) return handle;

  if (config.databaseUrl && !opts.forceEmbedded) {
    initPool(config.databaseUrl);
    handle = { connectionString: config.databaseUrl, stop: async () => {} };
    return handle;
  }

  // Imported here, not at the top: embedded-postgres carries a ~100 MB platform
  // binary that a cloud deployment with DATABASE_URL never touches. C'est une
  // dépendance OPTIONNELLE, et l'image du hub l'exclut — d'où le message ci-
  // dessous plutôt qu'un « module introuvable » pour qui oublie DATABASE_URL.
  let startEmbeddedPg;
  try {
    ({ startEmbeddedPg } = await import('./embedded.js'));
  } catch (cause) {
    const err = new Error(
      'DATABASE_URL est vide et PostgreSQL embarqué n’est pas installé sur cette machine. '
      + 'Sur un serveur (hub), définissez DATABASE_URL vers votre base. '
      + 'Sur un poste de travail, réinstallez les dépendances : npm --prefix server ci'
    );
    err.userFacing = true;
    err.cause = cause;
    throw err;
  }
  const embedded = await startEmbeddedPg({
    dataDir: opts.dataDir || process.env.EMBEDDED_PG_DIR || DEFAULT_DATA_DIR,
    port: opts.port || config.embeddedPgPort,
    persistent: opts.persistent ?? true,
  });
  initPool(embedded.connectionString);
  handle = embedded;
  return handle;
}
