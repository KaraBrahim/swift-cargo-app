-- Swift Cargo — une seule base, en ligne. La réplication s'en va.
--
-- L'application est née hors ligne : chaque bureau avait sa base, et des
-- déclencheurs recopiaient chaque ligne écrite dans `sync_outbox` pour la
-- pousser vers le hub. Il n'y a plus de bureaux hors ligne : les postes sont
-- des fenêtres sur ce serveur. Les déclencheurs continuaient pourtant de
-- sérialiser chaque insertion, mise à jour et suppression en JSON dans une
-- table que plus personne ne lisait — le double du travail d'écriture, et une
-- table qui grossissait sans fin.
--
-- Ce qui reste, et pourquoi :
--   • `uuid` sur chaque table — c'est l'identité des QR codes et des scans ;
--   • `origin_site` — colonne inerte, la retirer n'apporte rien et toucherait
--     tous les SELECT * ;
--   • `sync_site_code()` — les références (BP-HUB-00001…) en dépendent ; sans
--     `app.site` elle répond toujours HUB, exactement ce qu'elle a toujours
--     répondu ici.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tgname, relname
      FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE NOT tg.tgisinternal
       AND (tgname LIKE '%\_origin' OR tgname LIKE '%\_capture' OR tgname LIKE '%\_capture\_del')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t.tgname, t.relname);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS sync_capture();
DROP FUNCTION IF EXISTS sync_capture_delete();
DROP FUNCTION IF EXISTS sync_set_origin();
DROP FUNCTION IF EXISTS sync_apply_row(text, jsonb);
DROP FUNCTION IF EXISTS sync_apply_row(text, jsonb, text);
DROP TABLE IF EXISTS sync_outbox;
DROP TABLE IF EXISTS sync_cursor;
DROP SEQUENCE IF EXISTS sync_server_seq;
