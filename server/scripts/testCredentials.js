// Credentials for the test and smoke scripts.
//
// The application has no default password anywhere — see src/config.js. A test
// suite still needs a known one to log in with, and this is the right home for
// it: a fixture belonging to scripts that build a throwaway database and delete
// it again, never a value the server itself could fall back to in production.
//
// Import this FIRST in any script that seeds a database or logs in.
process.env.SEED_ADMIN_PASSWORD ||= 'Swift@2026';
process.env.SUPERADMIN_PASSWORD ||= 'Super@2026';
