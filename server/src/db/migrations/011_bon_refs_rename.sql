-- Swift Cargo — reference prefixes match the two physical documents.
-- Both a fournisseur and a passager receive a "bon". So:
--   orders (the fournisseur's shipment)  → "Bon fournisseur", prefix BF-
--   bons   (one passager's part)         → "Bon passager",    prefix BP-
-- This overrides the SC-/OP- defaults set in migration 005 and backfills the
-- existing rows. Safe on seed/dev data; in production, refs already printed on
-- paper documents would be frozen instead of rewritten.
ALTER TABLE bons  ALTER COLUMN reference SET DEFAULT
  ('BP-' || sync_site_code() || '-' || lpad(nextval('bon_ref_seq')::text, 5, '0'));
ALTER TABLE orders ALTER COLUMN reference SET DEFAULT
  ('BF-' || sync_site_code() || '-' || lpad(nextval('order_ref_seq')::text, 5, '0'));

UPDATE bons   SET reference = 'BP-' || substring(reference from 4) WHERE reference LIKE 'SC-%';
UPDATE orders SET reference = 'BF-' || substring(reference from 4) WHERE reference LIKE 'OP-%';
