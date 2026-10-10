-- Swift Cargo — le mouvement de stock sait de quelle LIGNE il vient.
--
-- Une remise au fournisseur sortait du stock d'Alger « tant de cet article, pour
-- cet ordre » — sans dire quelle ligne. Deux lignes du même article dans un
-- ordre se confondaient, et le journal de la marchandise ne pouvait pas dire ce
-- qui avait été remis de CHACUNE. Les mouvements d'avant gardent NULL : le
-- journal les rattache alors à la première ligne qui porte le même article.
ALTER TABLE stock_movements
  ADD COLUMN ref_line_id BIGINT REFERENCES bon_lines(id) ON DELETE SET NULL;
CREATE INDEX idx_stock_mov_line ON stock_movements(ref_line_id) WHERE ref_line_id IS NOT NULL;
