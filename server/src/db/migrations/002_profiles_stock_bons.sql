-- Swift Cargo — profiles, stock, and bons (vouchers).

-- ── Fournisseurs (suppliers) — profile only, no login ────────────────
CREATE TABLE fournisseurs (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  city       TEXT,
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Passagers (travelers) ────────────────────────────────────────────
CREATE TABLE passagers (
  id         SERIAL PRIMARY KEY,
  type       TEXT NOT NULL DEFAULT 'regular' CHECK (type IN ('regular','auto')), -- auto = auto-entrepreneur
  full_name  TEXT NOT NULL,
  phone      TEXT,
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Stock ────────────────────────────────────────────────────────────
CREATE TABLE stock_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stock_items (
  id          SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES stock_categories(id),
  name        TEXT NOT NULL,
  quantity    NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  weight_kg   NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
  cbm         NUMERIC(16,4) NOT NULL DEFAULT 0 CHECK (cbm >= 0),
  notes       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_items_cat ON stock_items(category_id);

-- Manual inventory count, confirmed by an admin (records the correction).
CREATE TABLE stock_inventory (
  id           BIGSERIAL PRIMARY KEY,
  item_id      INTEGER NOT NULL REFERENCES stock_items(id),
  previous_qty NUMERIC(16,3) NOT NULL,
  counted_qty  NUMERIC(16,3) NOT NULL,
  difference   NUMERIC(16,3) NOT NULL,
  note         TEXT,
  admin_id     INTEGER NOT NULL REFERENCES admins(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Bons (vouchers) — China -> Algeria, 4-stage lifecycle ────────────
CREATE SEQUENCE bon_ref_seq START 1;

CREATE TABLE bons (
  id                 BIGSERIAL PRIMARY KEY,
  reference          TEXT NOT NULL UNIQUE DEFAULT ('SC-' || lpad(nextval('bon_ref_seq')::text, 5, '0')),
  fournisseur_id     INTEGER NOT NULL REFERENCES fournisseurs(id),
  passager_id        INTEGER REFERENCES passagers(id),
  status             TEXT NOT NULL DEFAULT 'cree'
                       CHECK (status IN ('cree','en_transit','arrive','regle')),
  transport_currency TEXT NOT NULL DEFAULT 'DZD' REFERENCES currencies(code),
  transport_fee      NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (transport_fee >= 0),
  passager_payment   NUMERIC(20,2),          -- computed at settlement
  loss_total         NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (loss_total >= 0),
  notes              TEXT,
  created_by         INTEGER NOT NULL REFERENCES admins(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrived_at         TIMESTAMPTZ,
  settled_at         TIMESTAMPTZ
);
CREATE INDEX idx_bons_status ON bons(status);
CREATE INDEX idx_bons_created ON bons(created_at DESC);
CREATE INDEX idx_bons_fournisseur ON bons(fournisseur_id);
CREATE INDEX idx_bons_passager ON bons(passager_id);

-- Goods carried on a bon. received_quantity + loss filled at reconciliation.
CREATE TABLE bon_lines (
  id                BIGSERIAL PRIMARY KEY,
  bon_id            BIGINT NOT NULL REFERENCES bons(id) ON DELETE CASCADE,
  designation       TEXT NOT NULL,
  quantity          NUMERIC(16,3) NOT NULL CHECK (quantity > 0),
  weight_kg         NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
  cbm               NUMERIC(16,4) NOT NULL DEFAULT 0 CHECK (cbm >= 0),
  received_quantity NUMERIC(16,3),
  loss_value        NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (loss_value >= 0),
  responsible       TEXT,
  note              TEXT
);
CREATE INDEX idx_bon_lines_bon ON bon_lines(bon_id);

-- Immutable trail of every status change.
CREATE TABLE bon_status_history (
  id         BIGSERIAL PRIMARY KEY,
  bon_id     BIGINT NOT NULL REFERENCES bons(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  admin_id   INTEGER NOT NULL REFERENCES admins(id),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bon_status_hist ON bon_status_history(bon_id, created_at);
