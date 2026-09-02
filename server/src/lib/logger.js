// Minimal structured logger. Replaceable with pino later without touching call sites.
const ts = () => new Date().toISOString();
export const logger = {
  info: (msg, meta) => console.log(`${ts()} INFO  ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`${ts()} WARN  ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`${ts()} ERROR ${msg}`, meta ?? ''),
};
