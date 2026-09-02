-- Swift Cargo — dashboard & settings support.
--   * stock_items.min_quantity  → powers the "stock bas" alert rule
--   * app_settings              → key/value app configuration (alert thresholds…)
--   * time indexes              → the dashboard aggregates scan by created_at,
--     which previously had no supporting index on transactions/person_ledger.

ALTER TABLE stock_items
  ADD COLUMN min_quantity NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by INTEGER REFERENCES admins(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tx_created ON transactions(created_at DESC);
CREATE INDEX idx_person_ledger_created ON person_ledger(created_at DESC);
CREATE INDEX idx_person_ledger_bon ON person_ledger(ref_bon_id);
CREATE INDEX idx_bon_lines_received ON bon_lines(bon_id) WHERE received_quantity IS NULL;
CREATE INDEX idx_bons_created_only ON bons(created_at);
