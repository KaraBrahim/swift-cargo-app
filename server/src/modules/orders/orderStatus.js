// An order's status is DERIVED from how far its goods have travelled, and is
// cached on the order for fast filtering. Recompute runs inside the same tx
// whenever a bon fournisseur's lines change, a carrying bon passager moves, the
// goods are handed over, or the fournisseur pays.
//
// The goods of a bon fournisseur are handed to passagers line by line (a bon
// passager line draws from a bon fournisseur line). So:
//   ouverte    — some goods are still unallocated, waiting for a passager
//   en_transit — everything has been handed over, and is on its way
//   arrivée    — every carrying bon passager has arrived, and something that
//                arrived is still sitting in the Algiers office
//   livrée     — everything that arrived has been handed to the fournisseur
//   clôturée   — livrée, every carrier réglé, and the fee fully collected
//
// NOTHING here is ever set by hand. Five gates, five stages, one direction —
// which is what lets the stepper on screen be an indicator instead of a control
// that gets overwritten by this function a line later.
import { Decimal } from '../../lib/money.js';

// La quantité d'une ligne, dans la mesure qui est la sienne.
export const QTY = (t) => `CASE WHEN ${t}.measure='poids' THEN ${t}.weight_kg
                         WHEN ${t}.measure='cbm'   THEN ${t}.cbm
                         ELSE ${t}.quantity END`;

// Ce qui est ARRIVÉ d'une ligne fournisseur : ce que les bons passagers qui en
// tirent leur marchandise ont effectivement rapporté. `received_quantity` est
// ce qu'écrit la réconciliation (commandé − manquant) ; NULL veut dire « jamais
// réconcilié », donc tout. Seuls comptent les porteurs arrivés : la
// marchandise encore en vol n'est pas au bureau, et ne peut pas être remise.
// Écrit une seule fois et exporté : la fiche à l'écran doit proposer
// exactement ce que le service acceptera, et deux copies de cette règle
// finiraient par ne plus dire la même chose. Suppose la ligne fournisseur
// aliasée `bl`.
// Le cast n'est pas cosmétique : sans lui, une ligne dont rien n'est encore
// arrivé rend « 0 » (le littéral) là où une ligne servie rend « 34.000 » (la
// somme). Deux quantités, deux formats, et tout code qui compare des chaînes se
// trompe une fois sur deux.
export const ARRIVED = `COALESCE((
  SELECT SUM(COALESCE(cl.received_quantity, ${QTY('cl')}))
    FROM bon_lines cl
    JOIN bons cb ON cb.id = cl.bon_id
   WHERE cl.source_line_id = bl.id AND cb.status IN ('arrive','regle')), 0)::numeric(20,3)`;

// Les quantités sont des NUMERIC(20,3) : en deçà du millième, deux nombres sont
// le même nombre. Sans cette tolérance, un reste de 0.0000000001 laisserait un
// ordre entièrement livré bloqué à « arrivée » pour toujours.
const QTY_EPS = 0.0005;

export async function recomputeOrderStatus(client, orderId) {
  if (!orderId) return;

  // Ordered vs allocated quantity across the order's own (fournisseur) lines.
  const { rows: tot } = await client.query(
    `SELECT
       COALESCE(SUM(${QTY('bl')}), 0) AS ordered,
       COALESCE(SUM((SELECT COALESCE(SUM(${QTY('a')}), 0)
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
  const fullyAllocated = ordered > 0 && allocated >= ordered - QTY_EPS;

  // Combien de lignes ont encore, au bureau d'Alger, de la marchandise arrivée
  // que le fournisseur n'a pas emportée.
  const { rows: pend } = await client.query(
    `SELECT COUNT(*)::int AS pending
       FROM bon_lines bl
       JOIN bons b ON b.id = bl.bon_id
      WHERE b.order_id = $1
        AND ${ARRIVED} - bl.delivered_quantity > ${QTY_EPS}`,
    [orderId]
  );
  const deliveredFully = (pend[0]?.pending ?? 0) === 0;

  // Payé ? Le compte de l'ordre chez CE fournisseur, DEVISE PAR DEVISE : la
  // somme d'un solde en dinars et d'un solde en yuans ne veut rien dire, et une
  // seule des deux au rouge suffit à laisser l'ordre ouvert.
  //
  // Second bras : un fournisseur qui solde au comptoir (POST /people/:id/payment)
  // produit une écriture SANS ref_order_id — elle ne referme donc aucun ordre en
  // particulier. Si son compte entier est à zéro dans cette devise, il ne doit
  // plus rien, et il n'y a plus rien d'ouvert sur ses ordres non plus.
  const { rows: due } = await client.query(
    `WITH par_devise AS (
       SELECT pl.currency_code, SUM(pl.amount) AS net
         FROM person_ledger pl
         JOIN orders o ON o.id = $1
        WHERE pl.ref_order_id = $1
          AND pl.person_type = 'personne'
          AND pl.person_id = o.fournisseur_id
        GROUP BY pl.currency_code)
     SELECT COUNT(*)::int AS impayees
       FROM par_devise d
      WHERE d.net < -0.005
        AND COALESCE((SELECT pb.balance FROM person_balances pb
                        JOIN orders o2 ON o2.id = $1
                       WHERE pb.person_type = 'personne'
                         AND pb.person_id = o2.fournisseur_id
                         AND pb.currency_code = d.currency_code), 0) < -0.005`,
    [orderId]
  );
  const paid = (due[0]?.impayees ?? 0) === 0;

  const allArrived = stages.length > 0 && stages.every((s) => s === 'arrive' || s === 'regle');
  const allSettled = stages.length > 0 && stages.every((s) => s === 'regle');

  let status = 'ouverte';
  if (fullyAllocated && stages.length) {
    if (!allArrived) status = 'en_transit';
    else if (!deliveredFully) status = 'arrivee';
    else if (allSettled && paid) status = 'cloturee';
    else status = 'livree';
  }

  await client.query(
    `UPDATE orders SET
       status = $2,
       departed_at  = CASE WHEN departed_at  IS NULL AND $2 IN ('en_transit','arrivee','livree','cloturee') THEN now() ELSE departed_at END,
       arrived_at   = CASE WHEN arrived_at   IS NULL AND $2 IN ('arrivee','livree','cloturee') THEN now() ELSE arrived_at END,
       delivered_at = CASE WHEN delivered_at IS NULL AND $2 IN ('livree','cloturee') THEN now() ELSE delivered_at END,
       closed_at    = CASE WHEN closed_at    IS NULL AND $2 = 'cloturee' THEN now() ELSE closed_at END
     WHERE id = $1`,
    [orderId, status]
  );
  return status;
}

// Ce qu'il reste à remettre au fournisseur, ligne par ligne. Une seule lecture
// pour les trois questions qu'on lui pose : ce que porte UN ordre (la fiche et
// son bouton « Livrer »), ce qui attend UNE PERSONNE au comptoir (sa remise,
// tous ordres confondus), et ce que valent DES LIGNES précises (le contrôle du
// geste lui-même). Trois requêtes séparées auraient fini par ne plus dire la
// même chose que le service qui accepte ou refuse.
export async function deliverableLines(client, { orderId, personId, lineIds } = {}) {
  const conds = [];
  const params = [];
  if (orderId) { params.push(orderId); conds.push(`b.order_id = $${params.length}`); }
  // Une ligne fournisseur appartient à exactement un ordre, donc à exactement
  // une personne : « la marchandise de X » se lit sur l'ordre, sans ambiguïté.
  if (personId) { params.push(personId); conds.push(`o.fournisseur_id = $${params.length}`); }
  if (lineIds) { params.push(lineIds); conds.push(`bl.id = ANY($${params.length}::bigint[])`); }
  if (!conds.length) throw new Error('deliverableLines: aucun filtre — refus de lire toute la base.');

  const { rows } = await client.query(
    `SELECT bl.id, bl.bon_id, bl.item_id, bl.designation, bl.measure, bl.unit,
            ${QTY('bl')} AS quantity,
            bl.delivered_quantity,
            ${ARRIVED} AS arrived,
            o.id AS order_id, o.reference AS order_reference, o.fournisseur_id
       FROM bon_lines bl
       JOIN bons b   ON b.id = bl.bon_id
       JOIN orders o ON o.id = b.order_id
      WHERE ${conds.join(' AND ')}
      ORDER BY o.created_at, o.id, bl.id`,
    params
  );
  return rows.map((r) => ({
    ...r,
    deliverable: Decimal.max(new Decimal(r.arrived).minus(r.delivered_quantity), 0).toFixed(3),
  }));
}
