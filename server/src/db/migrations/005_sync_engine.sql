-- Swift Cargo — sync engine. Trigger-based change capture into sync_outbox, a
-- generic uuid-keyed apply function, a hub server_seq sequence, and site-prefixed
-- references. Config tables (currencies, admins, caisses) are seeded identically
-- on every node and are NOT captured. Projections (caisse_balances,
-- person_balances) are rebuilt from the event logs on apply.

CREATE SEQUENCE IF NOT EXISTS sync_server_seq START 1;

-- Site-prefixed references so two offline desks never collide.
CREATE OR REPLACE FUNCTION sync_site_code() RETURNS text AS $$
  SELECT CASE coalesce(current_setting('app.site', true), 'cloud')
           WHEN 'china' THEN 'CHN' WHEN 'algeria' THEN 'ALG' ELSE 'HUB' END;
$$ LANGUAGE sql;

ALTER TABLE bons  ALTER COLUMN reference SET DEFAULT
  ('SC-' || sync_site_code() || '-' || lpad(nextval('bon_ref_seq')::text, 5, '0'));
ALTER TABLE orders ALTER COLUMN reference SET DEFAULT
  ('OP-' || sync_site_code() || '-' || lpad(nextval('order_ref_seq')::text, 5, '0'));

-- Generic upsert of a row (as JSONB) into its table, keyed by uuid. Node id
-- ranges make the integer `id` globally unique, so FK references apply directly.
CREATE OR REPLACE FUNCTION sync_apply_row(p_entity text, p_snapshot jsonb) RETURNS void AS $$
DECLARE sets text;
BEGIN
  SELECT string_agg(format('%I=EXCLUDED.%I', column_name, column_name), ',')
    INTO sets
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = p_entity AND column_name NOT IN ('id', 'uuid');
  EXECUTE format(
    'INSERT INTO %I SELECT * FROM jsonb_populate_record(null::%I, $1) ON CONFLICT (uuid) DO UPDATE SET %s',
    p_entity, p_entity, sets
  ) USING p_snapshot;
END; $$ LANGUAGE plpgsql;

-- BEFORE INSERT: stamp origin_site with this node (unless we are applying remote).
CREATE OR REPLACE FUNCTION sync_set_origin() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('app.sync_applying', true), '') <> 'on' THEN
    NEW.origin_site := coalesce(current_setting('app.site', true), NEW.origin_site);
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- AFTER INSERT/UPDATE: capture the new row into the outbox (unless applying remote).
CREATE OR REPLACE FUNCTION sync_capture() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('app.sync_applying', true), '') = 'on' THEN RETURN NEW; END IF;
  INSERT INTO sync_outbox (uuid, entity, entity_uuid, op, snapshot, origin_site)
  VALUES (gen_random_uuid(), TG_TABLE_NAME, NEW.uuid, lower(TG_OP), to_jsonb(NEW),
          coalesce(current_setting('app.site', true), NEW.origin_site, 'cloud'));
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Attach to operational tables only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fournisseurs','passagers','stock_categories','stock_items','stock_inventory',
    'exchange_rates','orders','bons','bon_lines','bon_status_history',
    'transactions','conversions','person_ledger','audit_log'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION sync_set_origin()', t || '_origin', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sync_capture()', t || '_capture', t);
  END LOOP;
END $$;
