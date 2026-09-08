-- Swift Cargo — la marchandise repart enfin du bureau d'Alger.
--
-- Il manquait la dernière étape du voyage. `applyMovement` connaissait
-- `reception` (Chine +), `depart` (Chine −) et `arrivee` (Algérie +). Rien ne
-- sortait jamais d'Alger : le stock algérien ne pouvait que grossir, et il
-- comptait encore la marchandise remise au client il y a six mois.
--
-- Et la remise elle-même n'existait nulle part. Un ordre passait d'« arrivée »
-- à « clôturée » sans qu'on sache qui avait pris quoi, quand, ni combien.
--
-- D'où une cinquième étape — « livrée » — entre les deux, et la quantité
-- livrée ligne par ligne. Livrée LIGNE PAR LIGNE, parce qu'une livraison n'est
-- presque jamais entière : les manquants font qu'une partie n'arrive pas, et un
-- client prend souvent la moitié aujourd'hui et le reste la semaine prochaine.

ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('ouverte', 'en_transit', 'arrivee', 'livree', 'cloturee'));

ALTER TABLE orders ADD COLUMN delivered_at TIMESTAMPTZ;

-- Cumulée : chaque remise s'y ajoute. Le détail de chaque geste vit dans
-- stock_movements, qui devient du même coup l'historique des livraisons — une
-- table de plus n'aurait fait que répéter ce que celle-là dit déjà.
ALTER TABLE bon_lines ADD COLUMN delivered_quantity NUMERIC(20,3) NOT NULL DEFAULT 0
  CHECK (delivered_quantity >= 0);

-- La quatrième jambe du trajet.
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('reception', 'depart', 'arrivee', 'livraison', 'inventaire', 'ajustement'));

-- ── Reprise de l'existant ────────────────────────────────────────────
-- Sans elle, TOUT ordre aujourd'hui clôturé retomberait à « arrivée » à la
-- seconde où la nouvelle règle s'applique : elle exige désormais que ce qui est
-- arrivé ait été livré, et aucune ligne ne le dit encore.
--
-- On marque donc comme livré ce qui était arrivé sur ces ordres-là. Et on
-- n'écrit AUCUN mouvement de stock pour eux : cette marchandise est sortie
-- avant que l'application ne la suive, elle n'a jamais été comptée dans le
-- stock d'Alger tel qu'il est aujourd'hui, et inventer les sorties maintenant
-- ferait plonger les niveaux sous zéro.
UPDATE bon_lines bl
   SET delivered_quantity = COALESCE((
         SELECT SUM(COALESCE(cl.received_quantity,
                    CASE WHEN cl.measure = 'poids' THEN cl.weight_kg
                         WHEN cl.measure = 'cbm'   THEN cl.cbm
                         ELSE cl.quantity END))
           FROM bon_lines cl
           JOIN bons cb ON cb.id = cl.bon_id
          WHERE cl.source_line_id = bl.id AND cb.status IN ('arrive', 'regle')), 0)
  FROM bons b
  JOIN orders o ON o.id = b.order_id
 WHERE bl.bon_id = b.id AND o.status = 'cloturee';

UPDATE orders SET delivered_at = closed_at WHERE status = 'cloturee' AND closed_at IS NOT NULL;

-- Les lignes livrées se relisent par leur source à chaque calcul de statut.
CREATE INDEX IF NOT EXISTS idx_bon_lines_source ON bon_lines(source_line_id);
