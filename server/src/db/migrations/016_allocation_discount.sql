-- Swift Cargo — a bon passager no longer takes goods from the China stock
-- anonymously: each of its lines DRAWS from a specific bon fournisseur line.
-- One bon passager may draw from several bons fournisseurs, and may take only
-- part of a line's quantity — so the link lives on the line, not on the bon.
--
-- This also separates the two prices that were being conflated:
--   • a bon FOURNISSEUR line's unit_price = SALE price (what the fournisseur pays)
--   • a bon PASSAGER line's  unit_price = COST price (what the passager is paid)
-- The margin is the difference. Before this, both were posted as a charge to the
-- fournisseur, billing them twice for the same goods.

ALTER TABLE bon_lines ADD COLUMN source_line_id INTEGER REFERENCES bon_lines(id);
CREATE INDEX idx_bon_lines_source ON bon_lines(source_line_id);

-- Commercial gesture on a bon fournisseur: reduces what the fournisseur owes.
ALTER TABLE bons ADD COLUMN discount NUMERIC(20,2) NOT NULL DEFAULT 0
  CHECK (discount >= 0);
