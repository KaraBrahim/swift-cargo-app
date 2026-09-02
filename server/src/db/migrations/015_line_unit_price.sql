-- Swift Cargo — a bon line now carries a "prix de revient" (unit cost) applied per
-- its measure unit (piece / kg / m³). The bon's transport fee is DERIVED from the
-- lines: fee = Σ(unit_price × line quantity), no longer typed as a flat amount.
-- Missing units recorded at reconciliation reduce the delivered total that the
-- passager is paid and the fournisseur is billed.

ALTER TABLE bon_lines ADD COLUMN unit_price NUMERIC(20,2) NOT NULL DEFAULT 0
  CHECK (unit_price >= 0);
