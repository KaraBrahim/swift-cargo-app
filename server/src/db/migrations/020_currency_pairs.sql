-- A pair is a price in its own right.
--
-- Until now every conversion routed through the dinar: CNY -> DZD -> USD. That
-- is correct arithmetic and the wrong number, because the USD/CNY black-market
-- price is quoted on its own and is not the quotient of two dinar rates.
--
-- A pair therefore starts as `derive` — computed live from the two dinar rates,
-- so it can never go stale — and flips to `manuel` the first time someone types
-- a price. Only a `manuel` pair changes what a conversion charges.
CREATE TABLE currency_pairs (
  from_code  TEXT NOT NULL REFERENCES currencies(code),
  to_code    TEXT NOT NULL REFERENCES currencies(code),
  mode       TEXT NOT NULL DEFAULT 'derive' CHECK (mode IN ('derive','manuel')),
  created_by INTEGER REFERENCES admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uuid       UUID NOT NULL DEFAULT gen_random_uuid(),
  origin_site TEXT NOT NULL DEFAULT 'cloud',
  PRIMARY KEY (from_code, to_code),
  CHECK (from_code <> to_code)
);

-- Append-only, exactly like exchange_rates: the current value is the latest row,
-- and the rows before it are what the history card reads.
CREATE TABLE pair_rates (
  id             BIGSERIAL PRIMARY KEY,
  from_code      TEXT NOT NULL,
  to_code        TEXT NOT NULL,
  units_per_unit NUMERIC(24,8) NOT NULL CHECK (units_per_unit > 0),
  set_by         INTEGER REFERENCES admins(id),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  uuid           UUID NOT NULL DEFAULT gen_random_uuid(),
  origin_site    TEXT NOT NULL DEFAULT 'cloud',
  FOREIGN KEY (from_code, to_code) REFERENCES currency_pairs(from_code, to_code) ON DELETE CASCADE
);
CREATE INDEX idx_pair_rates_time ON pair_rates(from_code, to_code, created_at DESC);

-- sync_apply_row() merges with ON CONFLICT (uuid), which needs uuid to be
-- unique — the same index every other replicated table carries.
CREATE UNIQUE INDEX currency_pairs_uuid_uq ON currency_pairs(uuid);
CREATE UNIQUE INDEX pair_rates_uuid_uq ON pair_rates(uuid);

-- Replicate like every other operational table. A rate that only exists at one
-- desk is a rate the other desk converts money without — the uuid and
-- origin_site columns above are what the sync engine merges on.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['currency_pairs','pair_rates'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION sync_set_origin()', t || '_origin', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sync_capture()', t || '_capture', t);
  END LOOP;
END $$;
