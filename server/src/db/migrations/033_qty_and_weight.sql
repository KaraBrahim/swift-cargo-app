-- Swift Cargo — chaque ligne porte une QUANTITÉ et un POIDS, toujours ; le CBM
-- disparaît.
--
-- Avant, une ligne ne portait qu'UNE mesure (pièces, kilos ou m³) et le reste
-- restait à zéro : la marchandise ne pouvait pas dire « 10 cartons, 25 kg ».
-- Désormais `quantity` et `weight_kg` se saisissent ensemble, et `measure`
-- ne dit plus que par QUOI on multiplie le prix unitaire — la quantité ou le
-- poids. Tout le suivi (confié, arrivé, manquant, remis) se compte en
-- QUANTITÉ ; le poids s'en déduit au prorata.
--
-- Reprise de l'existant, sans toucher à un seul montant :
--   · une ligne mesurée au poids n'avait pas de quantité : sa quantité devient
--     son poids, en « kg » — le suivi (déjà en kilos) reste exact, au chiffre
--     près, et le prix (unit_price × poids) ne bouge pas ;
--   · une ligne mesurée au m³ de même : sa quantité devient son volume, en
--     « m³ », et elle se prend désormais à la quantité.
-- Les montants déjà écrits (transport_fee, loss_value, écritures de compte)
-- ne sont jamais recalculés ici.

-- Filet de sécurité : cette migration supprime des colonnes, et c'est sans retour.
-- Avant d'y toucher, on garde une copie de ce qu'elle va transformer. Si une
-- conversion s'avérait fausse, l'ancienne valeur est là, ligne pour ligne. Ces
-- copies ne servent qu'à ça : elles se suppriment (Maintenance, domaine
-- « Journal ») une fois la reprise vérifiée.
CREATE TABLE archive_033_bon_lines       AS SELECT * FROM bon_lines;
CREATE TABLE archive_033_stock_levels    AS SELECT * FROM stock_levels;
CREATE TABLE archive_033_stock_movements AS SELECT * FROM stock_movements;
CREATE TABLE archive_033_stock_items     AS SELECT id, quantity, weight_kg, cbm FROM stock_items;

UPDATE bon_lines SET quantity = weight_kg, unit = 'kg'
 WHERE measure = 'poids' AND quantity = 0 AND weight_kg > 0;
UPDATE bon_lines SET quantity = cbm, unit = 'm³', measure = 'quantite'
 WHERE measure = 'cbm' AND quantity = 0 AND cbm > 0;
-- Une ligne au m³ qui avait AUSSI une quantité garde sa quantité ; on ne fait
-- que changer sa mesure (son prix s'appliquera désormais à cette quantité).
UPDATE bon_lines SET measure = 'quantite' WHERE measure = 'cbm';

-- Le stock suit la même règle : ce qui n'était compté qu'en kilos ou en m³
-- devient une quantité du même nombre, mouvements et niveaux ensemble — un
-- niveau doit rester la somme de ses mouvements.
UPDATE stock_movements SET quantity_delta = weight_delta WHERE quantity_delta = 0 AND weight_delta <> 0;
UPDATE stock_movements SET quantity_delta = cbm_delta    WHERE quantity_delta = 0 AND cbm_delta <> 0;
UPDATE stock_levels    SET quantity = weight_kg WHERE quantity = 0 AND weight_kg > 0;
UPDATE stock_levels    SET quantity = cbm       WHERE quantity = 0 AND cbm > 0;

ALTER TABLE bon_lines DROP CONSTRAINT IF EXISTS bon_lines_measure_check;
ALTER TABLE bon_lines DROP COLUMN cbm;               -- emporte « au moins une mesure > 0 »
ALTER TABLE bon_lines ADD CONSTRAINT bon_lines_measure_check CHECK (measure IN ('quantite', 'poids'));
-- NOT VALID : ne contrôle que les lignes à venir. Une migration qui échouerait
-- sur une vieille ligne empêcherait le serveur de démarrer.
ALTER TABLE bon_lines ADD CONSTRAINT bon_lines_quantity_positive CHECK (quantity > 0) NOT VALID;

ALTER TABLE stock_movements DROP COLUMN cbm_delta;
ALTER TABLE stock_levels    DROP COLUMN cbm;
ALTER TABLE stock_items     DROP COLUMN cbm;
