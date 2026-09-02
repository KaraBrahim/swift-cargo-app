-- Swift Cargo — office-scoped stock. The article list stays SHARED (stock_items =
-- the catalogue: name + category), but quantities are per office (China / Algeria).
-- A movement ledger records every change; stock_levels is the running total,
-- updated transactionally (locked) alongside each movement.

CREATE TABLE stock_movements (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid(),
  origin_site    TEXT NOT NULL DEFAULT 'cloud',
  item_id        INTEGER NOT NULL REFERENCES stock_items(id),
  office         TEXT NOT NULL CHECK (office IN ('china', 'algeria')),
  quantity_delta NUMERIC(16,3) NOT NULL DEFAULT 0,
  weight_delta   NUMERIC(16,3) NOT NULL DEFAULT 0,
  cbm_delta      NUMERIC(16,4) NOT NULL DEFAULT 0,
  reason         TEXT NOT NULL CHECK (reason IN ('reception', 'depart', 'arrivee', 'inventaire', 'ajustement')),
  ref_order_id   BIGINT REFERENCES orders(id),
  ref_bon_id     BIGINT REFERENCES bons(id),
  admin_id       INTEGER REFERENCES admins(id),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_movements_uuid_uq ON stock_movements(uuid);
CREATE INDEX idx_stock_mov_item ON stock_movements(item_id, office);
CREATE INDEX idx_stock_mov_created ON stock_movements(created_at DESC);

CREATE TABLE stock_levels (
  item_id   INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  office    TEXT NOT NULL CHECK (office IN ('china', 'algeria')),
  quantity  NUMERIC(16,3) NOT NULL DEFAULT 0,
  weight_kg NUMERIC(16,3) NOT NULL DEFAULT 0,
  cbm       NUMERIC(16,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, office)
);

-- Backfill: whatever quantity a catalogue article currently holds becomes an
-- opening balance at China (goods arrive there first).
INSERT INTO stock_movements (item_id, office, quantity_delta, weight_delta, cbm_delta, reason, note)
  SELECT id, 'china', quantity, weight_kg, cbm, 'inventaire', 'Solde initial'
    FROM stock_items WHERE quantity > 0 OR weight_kg > 0 OR cbm > 0;

INSERT INTO stock_levels (item_id, office, quantity, weight_kg, cbm)
  SELECT id, 'china', quantity, weight_kg, cbm
    FROM stock_items WHERE quantity > 0 OR weight_kg > 0 OR cbm > 0
  ON CONFLICT (item_id, office) DO NOTHING;
