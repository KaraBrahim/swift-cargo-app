-- Goods lines get a selectable unit of measure (pièce, carton, kg, …).
ALTER TABLE bon_lines ADD COLUMN unit TEXT NOT NULL DEFAULT 'pièce';
