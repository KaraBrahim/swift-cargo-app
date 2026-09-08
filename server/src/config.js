import 'dotenv/config';

const bool = (v, def) => (v === undefined ? def : v === '1' || v === 'true');

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

export const config = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv,
  isProduction,

  // If DATABASE_URL is set we use it; otherwise fall back to embedded Postgres.
  databaseUrl: process.env.DATABASE_URL || '',
  useEmbeddedPg: bool(process.env.USE_EMBEDDED_PG, !process.env.DATABASE_URL),
  embeddedPgPort: Number(process.env.EMBEDDED_PG_PORT) || 55432,

  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS) || 12,
  // « Rester connecté » — a longer session, NOT a stored password. Checking the
  // box only asks the server for a session that lives this long instead of the
  // usual few hours; nothing extra is kept on the machine.
  rememberTtlDays: Number(process.env.REMEMBER_TTL_DAYS) || 3,

  // Login throttle. Counted separately per IP and per username: the IP limit is
  // what actually stops a guessing run, the username limit is a second net for
  // an attacker coming from many addresses. Windows are in minutes.
  loginMaxPerIp: Number(process.env.LOGIN_MAX_PER_IP) || 20,
  loginMaxPerUser: Number(process.env.LOGIN_MAX_PER_USER) || 8,
  loginWindowMinutes: Number(process.env.LOGIN_WINDOW_MINUTES) || 15,

  // bcrypt work factor for NEW hashes. Existing hashes keep the cost baked into
  // them and still verify, so this can be raised at any time.
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,

  // Seed passwords have NO default, in any environment. A password written in
  // the source is a password known to everyone who has ever seen the source, and
  // this is a cash ledger. Each context supplies its own instead:
  //   development  server/.env          (copied from .env.example)
  //   tests        scripts/testCredentials.js
  //   production   the real environment variables
  // Read through getters rather than captured at import time, so a script can
  // set them before anything uses them.
  get seedAdminPassword() { return process.env.SEED_ADMIN_PASSWORD || ''; },
  // The super-admin has full control (incl. admin CRUD) and its own password.
  // This is the ONE account seeded in production — see db/seed.js.
  get superadminPassword() { return process.env.SUPERADMIN_PASSWORD || ''; },

  // Send the session cookie only over HTTPS. On by default in production —
  // set COOKIE_SECURE=0 only for a LAN deployment with no TLS, knowing that
  // the token then travels in clear text.
  cookieSecure: bool(process.env.COOKIE_SECURE, (process.env.NODE_ENV || 'development') === 'production'),

  // Browser origins allowed to call the API with credentials. Empty = same
  // origin only, which is the right answer when the SPA is served by this
  // server or through the Vite proxy.
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Who is allowed to set the client IP. `true` means "believe the
  // X-Forwarded-For header from anyone", which is only correct behind a proxy
  // that overwrites it — otherwise any caller can invent an address, which
  // would both poison the audit trail and let the per-IP login limit be
  // side-stepped by rotating a fake header. Off by default; set to the number
  // of proxies in front of this server (usually 1) if there is one.
  //   TRUST_PROXY unset/0 -> direct   |   1, 2… -> that many proxies
  trustProxy: (() => {
    const v = process.env.TRUST_PROXY;
    if (v === undefined || v === '' || v === '0' || v === 'false') return false;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  })(),

  // Multi-site identity for offline sync: 'cloud' | 'china' | 'algeria'.
  site: process.env.SITE || 'cloud',
  // Desk nodes sync to this hub; empty on the hub itself.
  cloudUrl: process.env.CLOUD_URL || '',
  nodeToken: process.env.NODE_TOKEN || '',
  // Le rythme quand tout va bien. Court, parce que la synchronisation doit se
  // faire oublier : ce qu'un bureau saisit doit apparaître à l'autre en
  // quelques secondes. Une écriture locale, elle, part SANS attendre ce délai —
  // voir nudgeSync().
  syncIntervalMs: Number(process.env.SYNC_INTERVAL_MS) || 3000,
  // Le rythme quand la ligne est coupée. Réessayer toutes les 3 secondes pendant
  // une panne d'une journée ne rétablit rien : ça remplit le journal et réveille
  // la machine pour rien. Le délai double à chaque échec jusqu'à ce plafond,
  // puis repart au rythme court dès que ça repasse.
  syncMaxBackoffMs: Number(process.env.SYNC_MAX_BACKOFF_MS) || 60000,
};

// Per-node id ranges so offline nodes never collide on integer PKs.
export const ID_OFFSETS = { cloud: 1, china: 700_000_000, algeria: 1_400_000_000 };
