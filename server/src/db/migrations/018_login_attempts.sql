-- ─────────────────────────────────────────────────────────────────────
-- Brute-force protection for /auth/login.
--
-- Every attempt (success or failure) is recorded, for two reasons:
--   1. the throttle survives a server restart — an in-memory counter would
--      be cleared by anyone who can make the process restart;
--   2. a password-guessing run becomes visible instead of silent. Until now
--      only SUCCESSFUL logins were written to audit_log, so a thousand failed
--      attempts left no trace anywhere.
--
-- Deliberately NOT registered with the sync engine (005_sync_engine.sql
-- attaches its triggers from an explicit table list): throttling is per-node,
-- and a wrong password typed at the Chine desk is not Algérie's business.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE login_attempts (
  id        BIGSERIAL PRIMARY KEY,
  username  TEXT NOT NULL,
  ip        TEXT,
  success   BOOLEAN NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Both lookups are "how many failures in the last N minutes", hence (key, at).
-- lower(username) so changing the capitalisation does not reset the counter.
CREATE INDEX idx_login_attempts_user ON login_attempts (lower(username), at DESC);
CREATE INDEX idx_login_attempts_ip   ON login_attempts (ip, at DESC);
