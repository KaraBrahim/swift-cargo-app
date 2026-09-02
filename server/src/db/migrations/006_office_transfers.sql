-- Swift Cargo — inter-office cash transfers, modelled as TWO single-writer legs
-- so it stays conflict-free offline: the origin office records the OUT leg when
-- cash leaves; the destination office records the IN leg when it physically
-- arrives (possibly days later, after sync). Shared row (synced) links them.
CREATE SEQUENCE transfer_ref_seq START 1;

CREATE TABLE office_transfers (
  id                 BIGSERIAL PRIMARY KEY,
  reference          TEXT NOT NULL UNIQUE DEFAULT ('TR-' || sync_site_code() || '-' || lpad(nextval('transfer_ref_seq')::text, 5, '0')),
  from_office        TEXT NOT NULL CHECK (from_office IN ('china','algeria')),
  to_office          TEXT NOT NULL CHECK (to_office IN ('china','algeria')),
  currency_code      TEXT NOT NULL REFERENCES currencies(code),
  amount             NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  status             TEXT NOT NULL DEFAULT 'envoye' CHECK (status IN ('envoye','recu')),
  sent_caisse_id     INTEGER REFERENCES caisses(id),
  sent_tx_id         BIGINT,
  sent_by            INTEGER REFERENCES admins(id),
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_caisse_id INTEGER REFERENCES caisses(id),
  received_tx_id     BIGINT,
  received_by        INTEGER REFERENCES admins(id),
  received_at        TIMESTAMPTZ,
  note               TEXT,
  uuid               UUID NOT NULL DEFAULT gen_random_uuid(),
  origin_site        TEXT NOT NULL DEFAULT 'cloud',
  CHECK (from_office <> to_office)
);
CREATE UNIQUE INDEX office_transfers_uuid_uq ON office_transfers(uuid);
CREATE INDEX idx_office_transfers_status ON office_transfers(status);

-- Make it sync like the other operational tables.
CREATE TRIGGER office_transfers_origin  BEFORE INSERT ON office_transfers FOR EACH ROW EXECUTE FUNCTION sync_set_origin();
CREATE TRIGGER office_transfers_capture AFTER INSERT OR UPDATE ON office_transfers FOR EACH ROW EXECUTE FUNCTION sync_capture();
