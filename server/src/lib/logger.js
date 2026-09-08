// Minimal structured logger. Replaceable with pino later without touching call sites.
const ts = () => new Date().toISOString();
export const logger = {
  // Ce qui n'intéresse personne tant que tout va bien : un poste hors ligne qui
  // réessaie, par exemple. Muet sauf si on le demande (LOG_LEVEL=debug), parce
  // qu'un journal qu'on n'ouvre plus ne sert à rien le jour où il compte.
  debug: (msg, meta) => {
    if (process.env.LOG_LEVEL === 'debug') console.log(`${ts()} DEBUG ${msg}`, meta ?? '');
  },
  info: (msg, meta) => console.log(`${ts()} INFO  ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`${ts()} WARN  ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`${ts()} ERROR ${msg}`, meta ?? ''),
};
