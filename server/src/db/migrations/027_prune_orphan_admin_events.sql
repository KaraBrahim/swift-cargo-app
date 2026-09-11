-- Swift Cargo — effacer les évènements qui décrivent une identité disparue.
--
-- Ce que le poste vivait : la synchronisation ne démarrait pas, et le compte du
-- hub n'arrivait jamais. Le hub servait pourtant ses évènements sans broncher.
--
-- L'enchaînement. Le hub a d'abord semé son super-admin avec un uuid tiré au
-- hasard, et le déclencheur de capture l'a écrit dans `sync_outbox`. La 026 puis
-- le seed lui ont ensuite donné l'uuid convenu — celui que tous les postes
-- partagent. La LIGNE est donc réparée, mais le JOURNAL garde les évènements
-- d'avant, qui parlent d'un uuid que plus personne ne porte.
--
-- Le poste rejoue le journal depuis le début. Premier évènement : « insert
-- admins », uuid disparu. `sync_apply_row` fait ON CONFLICT (uuid), ne trouve
-- rien, bascule sur l'INSERT — et heurte l'unicité de `username`. Ce n'est pas
-- cet évènement-là qui est perdu : la transaction emporte TOUT le lot. Le poste
-- recommence au cycle suivant, échoue au même endroit, indéfiniment. Les bons
-- évènements, juste derrière, ne sont jamais atteints.
--
-- On efface donc ces évènements-là, et EUX SEULS. La condition dit exactement
-- de quoi il s'agit : un évènement dont l'identité n'existe plus, alors que le
-- nom d'utilisateur, lui, vit toujours sous une autre identité. C'est la
-- signature de la réécriture d'uuid, et rien d'autre ne lui ressemble.
--
-- Pourquoi ne PAS généraliser « l'identité n'existe plus » à tout le journal :
-- une ligne créée puis supprimée laisse elle aussi des évènements pointant vers
-- un uuid absent — et ceux-là sont parfaitement valides, il faut les rejouer
-- pour que la suppression arrive. D'où `op <> 'delete'` et la condition sur le
-- nom d'utilisateur, qui distinguent une identité RÉÉCRITE d'une ligne SUPPRIMÉE.
--
-- Ceci ne se reproduira pas : le seed pose désormais l'uuid dès l'INSERT
-- (server/src/db/seed.js), donc aucune machine neuve ne le réécrit après coup.
DELETE FROM sync_outbox o
 WHERE o.entity = 'admins'
   AND o.op <> 'delete'
   AND NOT EXISTS (SELECT 1 FROM admins a WHERE a.uuid = o.entity_uuid)
   AND EXISTS (SELECT 1 FROM admins a WHERE a.username = o.snapshot->>'username');
