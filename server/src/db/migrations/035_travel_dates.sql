-- Swift Cargo — les dates d'un voyage, et le retrait du fournisseur.
--
-- Un bon passager porte quatre dates : le départ PRÉVU et le départ RÉEL (il
-- part parfois en retard), l'arrivée PROMISE — la plus importante, celle sur
-- laquelle les gens organisent leur venue au bureau — et l'arrivée RÉELLE. Il
-- dit aussi où il atterrit (aéroport d'arrivée et sa wilaya) et avec quelle
-- compagnie. Un ordre fournisseur porte la date à laquelle le fournisseur doit
-- passer prendre sa marchandise.
--
-- Des DATES, pas des horodatages : « le 14 » est ce que la personne dit, et
-- un fuseau horaire ne doit pas la décaler d'un jour.
ALTER TABLE bons
  ADD COLUMN departure_planned_on DATE,
  ADD COLUMN departure_actual_on  DATE,
  ADD COLUMN arrival_promised_on  DATE,
  ADD COLUMN arrival_actual_on    DATE,
  ADD COLUMN airport              TEXT,
  ADD COLUMN airport_wilaya       TEXT,
  ADD COLUMN airline              TEXT;

ALTER TABLE orders ADD COLUMN pickup_expected_on DATE;

-- Reprise de l'existant : ce qu'on sait déjà de l'histoire des bons passagers.
UPDATE bons b
   SET departure_actual_on = (
         SELECT h.created_at::date FROM bon_status_history h
          WHERE h.bon_id = b.id AND h.status = 'en_transit' ORDER BY h.id LIMIT 1)
 WHERE b.order_id IS NULL AND b.status <> 'cree';
UPDATE bons SET arrival_actual_on = arrived_at::date
 WHERE order_id IS NULL AND arrived_at IS NOT NULL;

CREATE INDEX idx_bons_arrival_promised   ON bons(arrival_promised_on)  WHERE arrival_promised_on IS NOT NULL;
CREATE INDEX idx_bons_departure_planned  ON bons(departure_planned_on) WHERE departure_planned_on IS NOT NULL;
CREATE INDEX idx_orders_pickup_expected  ON orders(pickup_expected_on) WHERE pickup_expected_on IS NOT NULL;
