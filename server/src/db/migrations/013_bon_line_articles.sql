-- Swift Cargo — bon lines reference reusable stock articles, and a line is
-- quantified by exactly ONE measure (quantité, poids, or CBM) instead of always
-- filling all three.

-- Optional link to a catalogue article (free-text lines are still allowed).
ALTER TABLE bon_lines ADD COLUMN item_id INTEGER REFERENCES stock_items(id);
CREATE INDEX idx_bon_lines_item ON bon_lines(item_id);

-- Which single measure quantifies the line.
ALTER TABLE bon_lines ADD COLUMN measure TEXT NOT NULL DEFAULT 'quantite'
  CHECK (measure IN ('quantite', 'poids', 'cbm'));

-- Replace the "quantity > 0" rule with "at least one measure > 0", so a line can
-- be measured by weight or volume alone (quantity 0). Existing rows all have
-- quantity > 0, so they satisfy the new check and keep measure = 'quantite'.
ALTER TABLE bon_lines DROP CONSTRAINT IF EXISTS bon_lines_quantity_check;
ALTER TABLE bon_lines ADD CONSTRAINT bon_lines_measure_positive
  CHECK (quantity > 0 OR weight_kg > 0 OR cbm > 0);
