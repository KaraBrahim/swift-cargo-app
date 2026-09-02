-- Swift Cargo — orders (grouping bons), office caisses, and per-person accounts.

-- ── Admins get an office ─────────────────────────────────────────────
ALTER TABLE admins ADD COLUMN office TEXT CHECK (office IN ('china','algeria'));

-- ── Office caisses ───────────────────────────────────────────────────
-- Allow kind='office' and extend the ledger movement types.
ALTER TABLE caisses DROP CONSTRAINT caisses_kind_check;
ALTER TABLE caisses ADD CONSTRAINT caisses_kind_check CHECK (kind IN ('admin','global','office'));
CREATE UNIQUE INDEX uniq_office_caisse ON caisses(office) WHERE kind = 'office';

ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('deposit','withdrawal','conversion','transfer','adjustment','order_fee','passager_payment'));

-- ── Orders (Opération de transport) — one fournisseur shipment ───────
CREATE SEQUENCE order_ref_seq START 1;

CREATE TABLE orders (
  id             BIGSERIAL PRIMARY KEY,
  reference      TEXT NOT NULL UNIQUE DEFAULT ('OP-' || lpad(nextval('order_ref_seq')::text, 5, '0')),
  fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id),
  origin         TEXT NOT NULL DEFAULT 'china',
  destination    TEXT NOT NULL DEFAULT 'algeria',
  status         TEXT NOT NULL DEFAULT 'ouverte'
                   CHECK (status IN ('ouverte','en_transit','arrivee','cloturee')),
  notes          TEXT,
  created_by     INTEGER NOT NULL REFERENCES admins(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  departed_at    TIMESTAMPTZ,
  arrived_at     TIMESTAMPTZ,
  closed_at      TIMESTAMPTZ
);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_fournisseur ON orders(fournisseur_id);

-- A bon belongs to an order (one bon = one passager's part). Nullable so
-- standalone bons still work.
ALTER TABLE bons ADD COLUMN order_id BIGINT REFERENCES orders(id);
CREATE INDEX idx_bons_order ON bons(order_id);

-- ── Per-person accounts (fournisseurs & passagers) ───────────────────
-- balance = net amount the BUSINESS OWES the person (payable > 0, receivable < 0).
CREATE TABLE person_balances (
  person_type   TEXT NOT NULL CHECK (person_type IN ('fournisseur','passager')),
  person_id     INTEGER NOT NULL,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  balance       NUMERIC(20,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (person_type, person_id, currency_code)
);

CREATE TABLE person_ledger (
  id            BIGSERIAL PRIMARY KEY,
  person_type   TEXT NOT NULL CHECK (person_type IN ('fournisseur','passager')),
  person_id     INTEGER NOT NULL,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  amount        NUMERIC(20,2) NOT NULL,   -- signed delta applied to the balance
  balance_after NUMERIC(20,2) NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('transport_fee','fee_payment','passager_due','passager_payment','adjustment')),
  ref_order_id  BIGINT REFERENCES orders(id),
  ref_bon_id    BIGINT REFERENCES bons(id),
  caisse_tx_id  BIGINT REFERENCES transactions(id),
  admin_id      INTEGER NOT NULL REFERENCES admins(id),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_person_ledger ON person_ledger(person_type, person_id, created_at DESC);
