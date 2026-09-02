-- Swift Cargo — sync-readiness (offline / multi-site). Adds a stable cross-site
-- identity (uuid) + origin_site to every syncable table, plus the generic change
-- feed (sync_outbox) and the applied cursor (sync_cursor). The sync ENGINE
-- (worker + /sync endpoints) is built later; this only makes the schema ready so
-- nothing has to be retrofitted. Projections (caisse_balances, person_balances)
-- are intentionally excluded — they are rebuilt locally from the event logs.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admins','currencies','exchange_rates','caisses','transactions','conversions',
    'fournisseurs','passagers','stock_categories','stock_items','stock_inventory',
    'bons','bon_lines','bon_status_history','orders','person_ledger','audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN uuid UUID NOT NULL DEFAULT gen_random_uuid()', t);
    EXECUTE format('CREATE UNIQUE INDEX %I ON %I(uuid)', t || '_uuid_uq', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN origin_site TEXT NOT NULL DEFAULT ''cloud''', t);
  END LOOP;
END $$;

-- Generic change feed: one row per create/update, written inside the same tx as
-- the change. server_seq NULL = not yet acknowledged by the hub (= the outbox).
CREATE TABLE sync_outbox (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL UNIQUE,
  entity      TEXT NOT NULL,
  entity_uuid UUID NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('insert','update')),
  snapshot    JSONB NOT NULL,
  origin_site TEXT NOT NULL,
  server_seq  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_unpushed ON sync_outbox(id) WHERE server_seq IS NULL;

-- Highest hub server_seq this node has pulled + applied.
CREATE TABLE sync_cursor (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_server_seq BIGINT NOT NULL DEFAULT 0
);
INSERT INTO sync_cursor (id) VALUES (1) ON CONFLICT DO NOTHING;
