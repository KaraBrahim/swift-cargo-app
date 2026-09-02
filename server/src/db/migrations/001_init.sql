-- Swift Cargo — foundation + caisse schema.
-- All monetary columns are NUMERIC (exact). Rates are DZD-per-unit.

-- ── Admins & sessions ────────────────────────────────────────────────
CREATE TABLE admins (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_admin ON sessions(admin_id);

-- ── Currencies & black-market rates ──────────────────────────────────
CREATE TABLE currencies (
  code        TEXT PRIMARY KEY,             -- 'DZD','CNY','USD','EUR'
  name        TEXT NOT NULL,
  symbol      TEXT,
  minor_units SMALLINT NOT NULL DEFAULT 2 CHECK (minor_units BETWEEN 0 AND 4),
  is_base     BOOLEAN NOT NULL DEFAULT FALSE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Append-only rate history. The CURRENT rate for a currency is its most recent
-- row. DZD (base) also gets a row with dzd_per_unit = 1.
CREATE TABLE exchange_rates (
  id            BIGSERIAL PRIMARY KEY,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  dzd_per_unit  NUMERIC(24,8) NOT NULL CHECK (dzd_per_unit > 0),
  set_by        INTEGER REFERENCES admins(id),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rates_currency_time ON exchange_rates(currency_code, created_at DESC);

-- ── Caisses & per-currency balances ──────────────────────────────────
CREATE TABLE caisses (
  id             SERIAL PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('admin','global')),
  owner_admin_id INTEGER REFERENCES admins(id),  -- NULL for the global caisse
  office         TEXT,                            -- optional: 'china' / 'algeria'
  label          TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one admin caisse per admin; one global caisse
CREATE UNIQUE INDEX uniq_admin_caisse ON caisses(owner_admin_id) WHERE kind = 'admin';
CREATE UNIQUE INDEX uniq_global_caisse ON caisses((kind)) WHERE kind = 'global';

CREATE TABLE caisse_balances (
  caisse_id     INTEGER NOT NULL REFERENCES caisses(id) ON DELETE CASCADE,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  balance       NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  PRIMARY KEY (caisse_id, currency_code)
);

-- ── Ledger: every single money movement ──────────────────────────────
CREATE TABLE transactions (
  id                 BIGSERIAL PRIMARY KEY,
  caisse_id          INTEGER NOT NULL REFERENCES caisses(id),
  currency_code      TEXT NOT NULL REFERENCES currencies(code),
  direction          TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount             NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  balance_after      NUMERIC(20,2) NOT NULL CHECK (balance_after >= 0),
  type               TEXT NOT NULL CHECK (type IN ('deposit','withdrawal','conversion','transfer','adjustment')),
  ref_conversion_id  BIGINT,
  ref_transfer_id    BIGINT,
  note               TEXT,
  admin_id           INTEGER NOT NULL REFERENCES admins(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_caisse_time ON transactions(caisse_id, created_at DESC);
CREATE INDEX idx_tx_currency ON transactions(currency_code);

-- ── Conversions: full record of every currency transformation ────────
CREATE TABLE conversions (
  id             BIGSERIAL PRIMARY KEY,
  caisse_id      INTEGER NOT NULL REFERENCES caisses(id),
  from_currency  TEXT NOT NULL REFERENCES currencies(code),
  to_currency    TEXT NOT NULL REFERENCES currencies(code),
  from_amount    NUMERIC(20,2) NOT NULL CHECK (from_amount > 0),
  to_amount      NUMERIC(20,2) NOT NULL CHECK (to_amount > 0),
  from_rate_dzd  NUMERIC(24,8) NOT NULL,   -- DZD per from-unit at the moment
  to_rate_dzd    NUMERIC(24,8) NOT NULL,   -- DZD per to-unit at the moment
  dzd_value      NUMERIC(20,2) NOT NULL,   -- pivot value in DZD
  effective_rate NUMERIC(24,8) NOT NULL,   -- to-units per 1 from-unit
  admin_id       INTEGER NOT NULL REFERENCES admins(id),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_currency <> to_currency)
);
CREATE INDEX idx_conv_caisse_time ON conversions(caisse_id, created_at DESC);

-- ── Audit log: who did what, when ────────────────────────────────────
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  admin_id   INTEGER REFERENCES admins(id),
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  details    JSONB,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_time ON audit_log(created_at DESC);
