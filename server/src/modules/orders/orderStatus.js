// An order's status is DERIVED from how far its goods have travelled, and is
// cached on the order for fast filtering. Recompute runs inside the same tx
// whenever a bon fournisseur's lines change or a carrying bon passager moves.
//
// The goods of a bon fournisseur are handed to passagers line by line (a bon
// passager line draws from a bon fournisseur line). So:
//   ouverte    — some goods are still unallocated, waiting for a passager
//   en_transit — everything has been handed over, and is on its way
//   arrivée    — every carrying bon passager has arrived
//   clôturée   — every carrying bon passager is settled
export async function recomputeOrderStatus(client, orderId) {
  if (!orderId) return;

  // Ordered vs allocated quantity across the order's own (fournisseur) lines.
  const { rows: tot } = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN bl.measure='poids' THEN bl.weight_kg
                         WHEN bl.measure='cbm'   THEN bl.cbm
                         ELSE bl.quantity END), 0) AS ordered,
       COALESCE(SUM((SELECT COALESCE(SUM(CASE WHEN a.measure='poids' THEN a.weight_kg
                                              WHEN a.measure='cbm'   THEN a.cbm
                                              ELSE a.quantity END), 0)
                       FROM bon_lines a WHERE a.source_line_id = bl.id)), 0) AS allocated
     FROM bon_lines bl
     JOIN bons b ON b.id = bl.bon_id
    WHERE b.order_id = $1`,
    [orderId]
  );
  const ordered = Number(tot[0]?.ordered ?? 0);
  const allocated = Number(tot[0]?.allocated ?? 0);

  // Stages of the bons passagers actually carrying this order's goods.
  const { rows: carriers } = await client.query(
    `SELECT DISTINCT cb.status
       FROM bon_lines bl
       JOIN bons b ON b.id = bl.bon_id
       JOIN bon_lines cl ON cl.source_line_id = bl.id
       JOIN bons cb ON cb.id = cl.bon_id
      WHERE b.order_id = $1`,
    [orderId]
  );
  const stages = carriers.map((r) => r.status);
  const fullyAllocated = ordered > 0 && allocated >= ordered - 1e-9;

  let status = 'ouverte';
  if (fullyAllocated && stages.length) {
    if (stages.every((s) => s === 'regle')) status = 'cloturee';
    else if (stages.every((s) => s === 'arrive' || s === 'regle')) status = 'arrivee';
    else status = 'en_transit';
  }

  await client.query(
    `UPDATE orders SET
       status = $2,
       departed_at = CASE WHEN departed_at IS NULL AND $2 IN ('en_transit','arrivee','cloturee') THEN now() ELSE departed_at END,
       arrived_at  = CASE WHEN arrived_at  IS NULL AND $2 IN ('arrivee','cloturee') THEN now() ELSE arrived_at END,
       closed_at   = CASE WHEN closed_at   IS NULL AND $2 = 'cloturee' THEN now() ELSE closed_at END
     WHERE id = $1`,
    [orderId, status]
  );
  return status;
}
