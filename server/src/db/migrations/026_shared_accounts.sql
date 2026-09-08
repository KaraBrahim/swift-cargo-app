-- Swift Cargo — un seul système, une seule liste de comptes.
--
-- Le défaut, vécu : on installe le poste, on tape le mot de passe du serveur, et
-- l'application répond « identifiant ou mot de passe incorrect ». Chaque machine
-- avait ses propres comptes — la table `admins` n'était pas répliquée — donc
-- « l'application » n'en était pas une : c'étaient trois applications qui se
-- ressemblaient et qui partageaient les bons sans partager les gens.
--
-- La migration 004 avait pourtant préparé `admins` (uuid + origin_site) ; la 005
-- avait simplement choisi de ne pas y poser les déclencheurs. On les pose.
--
-- Ce qui NE se réplique toujours pas, et pour de bonnes raisons :
--   • `sessions` — un jeton de session appartient à la machine qui l'a émis.
--     Le répliquer reviendrait à rendre une session volée utilisable partout.
--   • les projections (soldes) — elles se recalculent, elles ne se copient pas.

-- ── 1 · Un seul super-admin, pas un par machine ──────────────────────
--
-- Chaque site a créé le sien au premier démarrage, avec un uuid tiré au hasard :
-- trois lignes différentes portant le même nom d'utilisateur. Répliquées telles
-- quelles, elles se heurteraient à l'unicité de `username` et la
-- synchronisation s'arrêterait là.
--
-- On leur donne donc à toutes le MÊME uuid. La réplication applique
-- « ON CONFLICT (uuid) DO UPDATE » : les trois lignes deviennent la même, et
-- c'est le mot de passe du hub qui l'emporte — ce qui est exactement le
-- comportement attendu d'un compte unique.
UPDATE admins
   SET uuid = '00000000-0000-4000-8000-000000000001'
 WHERE username = 'superadmin';

-- ── 2 · Les comptes rejoignent la réplication ────────────────────────
CREATE TRIGGER admins_origin BEFORE INSERT ON admins
  FOR EACH ROW EXECUTE FUNCTION sync_set_origin();
CREATE TRIGGER admins_capture AFTER INSERT OR UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION sync_capture();
CREATE TRIGGER admins_capture_del AFTER DELETE ON admins
  FOR EACH ROW EXECUTE FUNCTION sync_capture_delete();

-- ── 3 · Ce qui reste à savoir ────────────────────────────────────────
-- Deux bureaux qui créeraient hors ligne deux employés portant le MÊME
-- identifiant produiraient deux lignes d'uuid différents et de `username`
-- identique : la seconde serait refusée à l'application. Les comptes se créent
-- rarement et depuis un seul endroit, donc on accepte ce risque plutôt que de
-- renommer automatiquement quelqu'un dans son dos — ce serait pire.
