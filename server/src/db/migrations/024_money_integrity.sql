-- Swift Cargo — l'intégrité de l'argent, quatre trous bouchés.
--
-- 1. Une suppression ne se répliquait pas. Les triggers de capture étaient
--    posés AFTER INSERT OR UPDATE : un mouvement de caisse annulé à Alger
--    restait vivant en Chine, pour toujours. Et comme recomputeProjections()
--    reconstruit les soldes à partir de la table `transactions`, les deux
--    bureaux finissaient par afficher deux soldes différents pour la même
--    caisse, sans que rien ne le signale.
-- 2. Les charges de la société ne se répliquaient pas du tout, alors que le
--    mouvement de caisse qu'elles provoquent, lui, se répliquait : le bureau
--    d'en face voyait la sortie d'argent sans jamais savoir ce qu'elle payait.
-- 3. Une opération d'argent rejouée — un double-clic, un réessai après un
--    timeout réseau alors que le serveur avait déjà validé — s'exécutait deux
--    fois. La table `idempotency_keys` fait qu'un même geste, répété, rend la
--    même réponse au lieu de bouger l'argent une seconde fois.
-- 4. `currencies.minor_units` promettait de 0 à 4 décimales alors que TOUTES
--    les colonnes d'argent sont des NUMERIC(20,2). Une devise à 3 décimales
--    aurait été arrondie par Postgres sans un mot, pendant que le calcul en
--    mémoire, lui, en gardait 3.

-- ── 1 · La suppression est un événement comme un autre ───────────────────
ALTER TABLE sync_outbox DROP CONSTRAINT sync_outbox_op_check;
ALTER TABLE sync_outbox ADD CONSTRAINT sync_outbox_op_check
  CHECK (op IN ('insert', 'update', 'delete'));

-- La capture d'une suppression : la photo est celle de la ligne AVANT qu'elle
-- disparaisse, ce qui suffit à la retrouver ailleurs par son uuid.
CREATE OR REPLACE FUNCTION sync_capture_delete() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('app.sync_applying', true), '') = 'on' THEN RETURN OLD; END IF;
  INSERT INTO sync_outbox (uuid, entity, entity_uuid, op, snapshot, origin_site)
  VALUES (gen_random_uuid(), TG_TABLE_NAME, OLD.uuid, 'delete', to_jsonb(OLD),
          coalesce(current_setting('app.site', true), OLD.origin_site, 'cloud'));
  RETURN OLD;
END; $$ LANGUAGE plpgsql;

-- L'application, côté receveur, sait maintenant de quel geste il s'agit.
-- L'ancienne signature à deux arguments reste, et vaut « upsert » : un nœud
-- encore sur l'ancien code continue de fonctionner pendant le déploiement.
CREATE OR REPLACE FUNCTION sync_apply_row(p_entity text, p_snapshot jsonb, p_op text)
RETURNS void AS $$
DECLARE sets text;
BEGIN
  IF p_op = 'delete' THEN
    EXECUTE format('DELETE FROM %I WHERE uuid = ($1->>''uuid'')::uuid', p_entity) USING p_snapshot;
    RETURN;
  END IF;
  SELECT string_agg(format('%I=EXCLUDED.%I', column_name, column_name), ',')
    INTO sets
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = p_entity AND column_name NOT IN ('id', 'uuid');
  EXECUTE format(
    'INSERT INTO %I SELECT * FROM jsonb_populate_record(null::%I, $1) ON CONFLICT (uuid) DO UPDATE SET %s',
    p_entity, p_entity, sets
  ) USING p_snapshot;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_apply_row(p_entity text, p_snapshot jsonb)
RETURNS void AS $$
  SELECT sync_apply_row(p_entity, p_snapshot, 'upsert');
$$ LANGUAGE sql;

-- ── 2 · Les charges rejoignent les tables répliquées ─────────────────────
CREATE TRIGGER charges_origin BEFORE INSERT ON charges
  FOR EACH ROW EXECUTE FUNCTION sync_set_origin();
CREATE TRIGGER charges_capture AFTER INSERT OR UPDATE ON charges
  FOR EACH ROW EXECUTE FUNCTION sync_capture();

-- ── Le trigger de suppression, sur tout ce qui se réplique ───────────────
-- La liste n'est pas recopiée : elle se lit sur les triggers de capture déjà
-- posés, pour qu'une table ajoutée demain ne puisse pas être oubliée ici.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT DISTINCT c.relname
      FROM pg_trigger g
      JOIN pg_class c ON c.oid = g.tgrelid
      JOIN pg_proc p ON p.oid = g.tgfoid
     WHERE p.proname = 'sync_capture' AND NOT g.tgisinternal
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sync_capture_delete()',
      t || '_capture_del', t
    );
  END LOOP;
END $$;

-- ── 3 · Rejouer un geste d'argent ne le fait pas deux fois ───────────────
-- Le client envoie une clé par TENTATIVE d'opération, pas par requête : un
-- réessai après un timeout porte la même clé et retrouve la réponse d'origine.
CREATE TABLE idempotency_keys (
  key          TEXT PRIMARY KEY,
  admin_id     INTEGER NOT NULL REFERENCES admins(id),
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  -- Empreinte du corps : la même clé avec une AUTRE requête est une erreur du
  -- client, pas un réessai, et doit être refusée plutôt que servie de travers.
  fingerprint  TEXT NOT NULL,
  status       INTEGER,
  response     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_idempotency_age ON idempotency_keys(created_at);

-- ── 4 · L'échelle promise est celle que les colonnes tiennent ────────────
ALTER TABLE currencies DROP CONSTRAINT currencies_minor_units_check;
ALTER TABLE currencies ADD CONSTRAINT currencies_minor_units_check
  CHECK (minor_units = 2);
