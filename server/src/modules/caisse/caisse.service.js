// The caisse core. Every mutation runs inside a single DB transaction, locks the
// affected balance rows with SELECT ... FOR UPDATE (so two admins cannot race the
// same caisse), guards against overdraft, writes the ledger + audit atomically,
// and does all arithmetic through the exact-decimal money lib.
import { getPool, withTx } from '../../db/pool.js';
import { Decimal, parseAmount, money } from '../../lib/money.js';
import { convert } from '../../lib/rates.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { getCurrentRates, directRateFor } from '../rates/rates.service.js';

const DZD_SCALE = 2;

// ── internal helpers (all take the transaction's client) ─────────────
async function loadCurrency(client, code) {
  const { rows } = await client.query('SELECT * FROM currencies WHERE code = $1', [code]);
  if (!rows[0]) throw errors.notFound(`Devise inconnue : ${code}.`);
  if (!rows[0].active) throw errors.conflict(`Devise inactive : ${code}.`);
  return rows[0];
}

async function loadCaisse(client, id) {
  const { rows } = await client.query('SELECT * FROM caisses WHERE id = $1', [id]);
  if (!rows[0]) throw errors.notFound('Caisse introuvable.');
  if (!rows[0].active) throw errors.conflict('Caisse inactive.');
  return rows[0];
}

async function lockBalance(client, caisseId, code) {
  await client.query(
    `INSERT INTO caisse_balances (caisse_id, currency_code) VALUES ($1,$2)
     ON CONFLICT (caisse_id, currency_code) DO NOTHING`,
    [caisseId, code]
  );
  const { rows } = await client.query(
    'SELECT balance FROM caisse_balances WHERE caisse_id = $1 AND currency_code = $2 FOR UPDATE',
    [caisseId, code]
  );
  // The INSERT above guarantees the row, so an empty result means the caisse or
  // the currency vanished under us. Say so, rather than dying on rows[0].
  if (!rows[0]) throw errors.conflict(`Solde introuvable pour la caisse ${caisseId} en ${code}.`);
  return new Decimal(rows[0].balance);
}

// The number of decimals this currency is kept at. Every write of a balance has
// to use it, or two code paths round the same money differently.
async function currencyScale(client, code) {
  const { rows } = await client.query('SELECT minor_units FROM currencies WHERE code = $1', [code]);
  if (!rows[0]) throw errors.notFound(`Devise inconnue : ${code}.`);
  return rows[0].minor_units;
}

async function setBalance(client, caisseId, code, valueStr) {
  await client.query(
    'UPDATE caisse_balances SET balance = $3 WHERE caisse_id = $1 AND currency_code = $2',
    [caisseId, code, valueStr]
  );
}

async function insertTx(client, tx) {
  const { rows } = await client.query(
    `INSERT INTO transactions
       (caisse_id, currency_code, direction, amount, balance_after, type, ref_conversion_id, ref_transfer_id, note, admin_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [tx.caisseId, tx.currency, tx.direction, tx.amount, tx.balanceAfter, tx.type,
     tx.refConversionId ?? null, tx.refTransferId ?? null, tx.note ?? null, tx.adminId]
  );
  return rows[0].id;
}

// ── queries ──────────────────────────────────────────────────────────
export async function listCaisses() {
  const { rows } = await getPool().query(
    `SELECT c.*,
            COALESCE(json_object_agg(b.currency_code, b.balance)
                     FILTER (WHERE b.currency_code IS NOT NULL), '{}') AS balances
       FROM caisses c
       LEFT JOIN caisse_balances b ON b.caisse_id = c.id
      GROUP BY c.id
      -- Algeria first: it is the office the money is managed from day to day,
      -- so it should be the caisse in front of you and the default in every
      -- selector. This one ORDER BY drives the cards, the dropdowns and the
      -- transfer form alike — the client renders in the order it receives.
      ORDER BY c.kind,
               CASE c.office WHEN 'algeria' THEN 0 WHEN 'china' THEN 1 ELSE 2 END,
               c.id`
  );
  return rows;
}

export async function getCaisseDetail(caisseId) {
  const caisse = await loadCaisse(getPool(), caisseId);
  const { rows: balances } = await getPool().query(
    `SELECT b.currency_code, b.balance, cur.name, cur.symbol
       FROM caisse_balances b JOIN currencies cur ON cur.code = b.currency_code
      WHERE b.caisse_id = $1 ORDER BY cur.sort_order`,
    [caisseId]
  );
  return { ...caisse, balances };
}

// Who has moved money in this caisse, and how often — the tabs above the
// movements are built from this rather than from the list of all admins, so a
// colleague who never touched this till does not get an empty tab.
//
// The super-admin is left out for everyone, including a super-admin viewer:
// there is to be no tab bearing that name. Their movements stay in "Tous",
// where the balance needs them and where the name is already masked.
export async function ledgerActors(caisseId, db = getPool()) {
  const [{ rows }, { rows: totals }] = await Promise.all([
    db.query(
      `SELECT t.admin_id, a.full_name, COUNT(*)::int AS n
         FROM transactions t JOIN admins a ON a.id = t.admin_id
        WHERE t.caisse_id = $1 AND a.role <> 'superadmin'
        GROUP BY t.admin_id, a.full_name
        ORDER BY a.full_name`,
      [caisseId]
    ),
    // "Tous" counts every movement, including the ones the tabs leave out, so
    // the number matches the rows actually listed under it.
    db.query('SELECT COUNT(*)::int AS n FROM transactions WHERE caisse_id = $1', [caisseId]),
  ]);
  return { actors: rows, total: totals[0].n };
}

export async function ledger(caisseId, { limit = 100, currency, adminId } = {}) {
  const params = [caisseId, limit];
  let where = 'WHERE t.caisse_id = $1';
  if (currency) {
    params.push(currency);
    where += ` AND t.currency_code = $${params.length}`;
  }
  if (adminId) {
    params.push(adminId);
    where += ` AND t.admin_id = $${params.length}`;
  }
  const { rows } = await getPool().query(
    `SELECT t.*, a.full_name AS admin_name, a.role AS admin_role
       FROM transactions t JOIN admins a ON a.id = t.admin_id
       ${where}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $2`,
    params
  );
  return rows;
}

// Reusable single-leg caisse movement for callers that need it inside their OWN
// transaction (e.g. auto-posting an order's fee/payment atomically with a
// person-account entry). Locks the balance, guards overdraft, writes the ledger.
// `allowNegative` is opt-in and has exactly one caller: confirming a transfer
// whose sending caisse has since been emptied. See 019_transfer_forced.sql.
export async function postMovement(client, { caisseId, currency, direction, amount, type, note, adminId, allowNegative = false }) {
  await loadCaisse(client, caisseId);
  const cur = await loadCurrency(client, currency);
  const amt = parseAmount(amount, cur.minor_units);
  const bal = await lockBalance(client, caisseId, currency);
  let newBal;
  if (direction === 'out') {
    if (bal.lt(amt) && !allowNegative) {
      throw errors.insufficientFunds({
        currency, available: money(bal, cur.minor_units), required: money(amt, cur.minor_units),
      });
    }
    newBal = money(bal.minus(amt), cur.minor_units);
  } else {
    newBal = money(bal.plus(amt), cur.minor_units);
  }
  await setBalance(client, caisseId, currency, newBal);
  const txId = await insertTx(client, {
    caisseId, currency, direction, amount: money(amt, cur.minor_units),
    balanceAfter: newBal, type, note, adminId,
  });
  return { txId, balanceAfter: newBal };
}

// ── Editing / removing a caisse movement ─────────────────────────────
// A ledger row's balance_after is a running total, so touching one row
// invalidates every later row of the same caisse+currency. Rather than patch a
// single row, replay the whole chain from the movements themselves — and refuse
// if the replay would ever drive the till negative.
// A caisse that was deliberately forced negative (a transfer confirmed while its
// origin was empty) must stay CORRECTABLE — otherwise the missing deposit that
// would repair it could never be entered, and the caisse would be frozen at a
// wrong figure forever. So the negative-balance guard below refuses a dip an
// operation CREATES, but steps aside on a caisse whose dip is already explained.
async function hasForcedTransfer(c, caisseId, currency) {
  const { rows } = await c.query(
    `SELECT 1 FROM office_transfers
      WHERE forced AND currency_code = $2 AND (sent_caisse_id = $1 OR received_caisse_id = $1)
      LIMIT 1`,
    [caisseId, currency]
  );
  return rows.length > 0;
}

export async function replayChain(c, caisseId, currency) {
  // Take the caisse's lock BEFORE reading a single sum. Without it, a deposit
  // committing between the SUM below and the UPDATE at the end is simply
  // erased: this function would write a total computed when that movement did
  // not yet exist. postMovement() holds the same lock, so the two serialise.
  await lockBalance(c, caisseId, currency);
  const scale = await currencyScale(c, currency);
  const { rows } = await c.query(
    `WITH ordered AS (
       SELECT id, SUM(CASE WHEN direction='in' THEN amount ELSE -amount END)
                    OVER (ORDER BY created_at, id ROWS UNBOUNDED PRECEDING) AS running
         FROM transactions WHERE caisse_id=$1 AND currency_code=$2
     )
     SELECT id, running FROM ordered ORDER BY running ASC LIMIT 1`,
    [caisseId, currency]
  );
  if (rows[0] && new Decimal(rows[0].running).lt(0) && !(await hasForcedTransfer(c, caisseId, currency))) {
    throw errors.conflict('Opération refusée : le solde de la caisse deviendrait négatif à un moment de son historique.');
  }
  await c.query(
    `WITH ordered AS (
       SELECT id, SUM(CASE WHEN direction='in' THEN amount ELSE -amount END)
                    OVER (ORDER BY created_at, id ROWS UNBOUNDED PRECEDING) AS running
         FROM transactions WHERE caisse_id=$1 AND currency_code=$2
     )
     UPDATE transactions t SET balance_after = o.running FROM ordered o WHERE t.id = o.id`,
    [caisseId, currency]
  );
  const total = await c.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS bal
       FROM transactions WHERE caisse_id=$1 AND currency_code=$2`,
    [caisseId, currency]
  );
  await setBalance(c, caisseId, currency, new Decimal(total.rows[0].bal).toFixed(scale));
  return total.rows[0].bal;
}

// Only movements typed by hand may be reshaped here. Anything generated by a bon,
// a conversion or a transfer must be corrected at its source, or the two sides
// would disagree.
async function loadEditableTx(c, id) {
  const { rows } = await c.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE', [id]);
  const tx = rows[0];
  if (!tx) throw errors.notFound('Opération introuvable.');
  if (tx.ref_conversion_id) throw errors.conflict('Cette opération fait partie d’une conversion : modifiez la conversion elle-même.');
  if (tx.ref_transfer_id) throw errors.conflict('Cette opération fait partie d’un transfert : modifiez-le depuis « Transferts ».');
  if (!['deposit', 'withdrawal', 'adjustment'].includes(tx.type)) {
    throw errors.conflict('Cette opération provient d’un bon : modifiez-la depuis le bon concerné.');
  }
  const linked = await c.query('SELECT 1 FROM person_ledger WHERE caisse_tx_id=$1 LIMIT 1', [id]);
  if (linked.rows.length) throw errors.conflict('Cette opération est liée au compte d’une personne : passez par le bon ou la fiche concernée.');
  return tx;
}

export async function updateMovement({ admin, id, amount, note, ip }) {
  return withTx(async (c) => {
    const tx = await loadEditableTx(c, id);
    const cur = await loadCurrency(c, tx.currency_code);
    const next = amount != null && amount !== '' ? money(parseAmount(amount, cur.minor_units), cur.minor_units) : tx.amount;
    if (!(new Decimal(next).gt(0))) throw errors.invalidAmount('Le montant doit être supérieur à zéro.');

    await c.query('UPDATE transactions SET amount=$2, note=$3 WHERE id=$1', [id, next, note ?? tx.note]);
    await replayChain(c, tx.caisse_id, tx.currency_code);
    await writeAudit(c, {
      adminId: admin.id, action: 'caisse.tx.update', entity: 'transaction', entityId: id,
      details: { from: tx.amount, to: next }, ip,
    });
    return (await c.query('SELECT * FROM transactions WHERE id=$1', [id])).rows[0];
  });
}

export async function deleteMovement({ admin, id, ip }) {
  return withTx(async (c) => {
    const tx = await loadEditableTx(c, id);
    await c.query('DELETE FROM transactions WHERE id=$1', [id]);
    await replayChain(c, tx.caisse_id, tx.currency_code);
    await writeAudit(c, {
      adminId: admin.id, action: 'caisse.tx.delete', entity: 'transaction', entityId: id,
      details: { amount: tx.amount, currency: tx.currency_code, type: tx.type }, ip,
    });
    return { deleted: true };
  });
}

export async function listConversions(caisseId, { limit = 100 } = {}) {
  const { rows } = await getPool().query(
    `SELECT cv.*, a.full_name AS admin_name, a.role AS admin_role
       FROM conversions cv JOIN admins a ON a.id = cv.admin_id
      WHERE cv.caisse_id = $1
      ORDER BY cv.created_at DESC, cv.id DESC LIMIT $2`,
    [caisseId, limit]
  );
  return rows;
}

// ── Wallet (caisse) CRUD ───────────────────────────────────────────────
export async function createCaisse({ admin, label, office, ip }) {
  return withTx(async (client) => {
    const ins = await client.query(
      `INSERT INTO caisses (kind, office, label) VALUES ('office', $1, $2) RETURNING *`,
      [office || null, label]
    );
    const caisse = ins.rows[0];
    await client.query(
      `INSERT INTO caisse_balances (caisse_id, currency_code) SELECT $1, code FROM currencies
       ON CONFLICT (caisse_id, currency_code) DO NOTHING`,
      [caisse.id]
    );
    await writeAudit(client, { adminId: admin.id, action: 'caisse.create', entity: 'caisse', entityId: caisse.id, details: { label }, ip });
    return caisse;
  });
}

export async function updateCaisse({ admin, id, label, ip }) {
  return withTx(async (client) => {
    const { rows } = await client.query('UPDATE caisses SET label = $2 WHERE id = $1 RETURNING *', [id, label]);
    if (!rows[0]) throw errors.notFound('Caisse introuvable.');
    await writeAudit(client, { adminId: admin.id, action: 'caisse.update', entity: 'caisse', entityId: id, ip });
    return rows[0];
  });
}

export async function setCaisseActive({ admin, id, active, ip }) {
  return withTx(async (client) => {
    if (!active) {
      const held = await client.query('SELECT 1 FROM caisse_balances WHERE caisse_id = $1 AND balance <> 0 LIMIT 1', [id]);
      if (held.rows.length) throw errors.conflict('Impossible de retirer une caisse avec un solde non nul.');
    }
    const { rows } = await client.query('UPDATE caisses SET active = $2 WHERE id = $1 RETURNING *', [id, active]);
    if (!rows[0]) throw errors.notFound('Caisse introuvable.');
    await writeAudit(client, { adminId: admin.id, action: 'caisse.set_active', entity: 'caisse', entityId: id, details: { active }, ip });
    return rows[0];
  });
}

// ── mutations ─────────────────────────────────────────────────────────
export async function deposit({ admin, caisseId, currency, amount, note, ip }) {
  return withTx(async (client) => {
    await loadCaisse(client, caisseId);
    const cur = await loadCurrency(client, currency);
    const amt = parseAmount(amount, cur.minor_units);

    const bal = await lockBalance(client, caisseId, currency);
    const newBal = money(bal.plus(amt), cur.minor_units);
    await setBalance(client, caisseId, currency, newBal);

    const txId = await insertTx(client, {
      caisseId, currency, direction: 'in', amount: money(amt, cur.minor_units),
      balanceAfter: newBal, type: 'deposit', note, adminId: admin.id,
    });
    await writeAudit(client, {
      adminId: admin.id, action: 'caisse.deposit', entity: 'transaction', entityId: txId,
      details: { caisseId, currency, amount: money(amt, cur.minor_units) }, ip,
    });
    return { transactionId: txId, currency, balance: newBal };
  });
}

export async function withdraw({ admin, caisseId, currency, amount, note, ip }) {
  return withTx(async (client) => {
    await loadCaisse(client, caisseId);
    const cur = await loadCurrency(client, currency);
    const amt = parseAmount(amount, cur.minor_units);

    const bal = await lockBalance(client, caisseId, currency);
    if (bal.lt(amt)) {
      throw errors.insufficientFunds({
        currency, available: money(bal, cur.minor_units), required: money(amt, cur.minor_units),
      });
    }
    const newBal = money(bal.minus(amt), cur.minor_units);
    await setBalance(client, caisseId, currency, newBal);

    const txId = await insertTx(client, {
      caisseId, currency, direction: 'out', amount: money(amt, cur.minor_units),
      balanceAfter: newBal, type: 'withdrawal', note, adminId: admin.id,
    });
    await writeAudit(client, {
      adminId: admin.id, action: 'caisse.withdraw', entity: 'transaction', entityId: txId,
      details: { caisseId, currency, amount: money(amt, cur.minor_units) }, ip,
    });
    return { transactionId: txId, currency, balance: newBal };
  });
}

// Black-market currency exchange within one caisse (DZD-pivot).
export async function convertCurrency({ admin, caisseId, fromCurrency, toCurrency, amount, note, ip }) {
  if (fromCurrency === toCurrency) {
    throw errors.validation([{ field: 'toCurrency', message: 'Devises source et cible identiques.' }]);
  }
  return withTx(async (client) => {
    await loadCaisse(client, caisseId);
    const fromCur = await loadCurrency(client, fromCurrency);
    const toCur = await loadCurrency(client, toCurrency);
    const amt = parseAmount(amount, fromCur.minor_units);

    const rates = await getCurrentRates(client);
    const fromRate = fromCur.is_base ? '1' : rates[fromCurrency];
    const toRate = toCur.is_base ? '1' : rates[toCurrency];
    if (fromRate == null) throw errors.noRate(fromCurrency);
    if (toRate == null) throw errors.noRate(toCurrency);

    // A pair quoted by hand is the price this house trades at; without one the
    // conversion routes through the dinar exactly as it always has.
    const directRate = await directRateFor(client, fromCurrency, toCurrency);

    const { dzdValue, toAmount, effectiveRate, toRateDzd } = convert({
      fromAmount: amt, fromRateDzd: fromRate, toRateDzd: toRate,
      fromCode: fromCurrency, toCode: toCurrency, toScale: toCur.minor_units,
      directRate,
    });
    if (toAmount.lte(0)) {
      throw errors.invalidAmount('Montant converti trop faible (arrondi à zéro).');
    }

    // Lock both balance rows in a deterministic order to avoid deadlocks.
    const order = [fromCurrency, toCurrency].sort();
    const locked = {};
    for (const code of order) locked[code] = await lockBalance(client, caisseId, code);

    if (locked[fromCurrency].lt(amt)) {
      throw errors.insufficientFunds({
        currency: fromCurrency,
        available: money(locked[fromCurrency], fromCur.minor_units),
        required: money(amt, fromCur.minor_units),
      });
    }

    const newFrom = money(locked[fromCurrency].minus(amt), fromCur.minor_units);
    const newTo = money(locked[toCurrency].plus(toAmount), toCur.minor_units);
    await setBalance(client, caisseId, fromCurrency, newFrom);
    await setBalance(client, caisseId, toCurrency, newTo);

    const conv = await client.query(
      `INSERT INTO conversions
         (caisse_id, from_currency, to_currency, from_amount, to_amount,
          from_rate_dzd, to_rate_dzd, dzd_value, effective_rate, admin_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      // to_rate_dzd is what convert() returns, not the board rate: with a quoted
      // pair they differ, and storing the board rate would leave the row saying
      // to_amount = dzd_value / to_rate_dzd when it does not.
      [caisseId, fromCurrency, toCurrency, money(amt, fromCur.minor_units),
       money(toAmount, toCur.minor_units), fromRate, toRateDzd.toFixed(8), money(dzdValue, DZD_SCALE),
       effectiveRate.toFixed(8), admin.id, note ?? null]
    );
    const conversion = conv.rows[0];

    await insertTx(client, {
      caisseId, currency: fromCurrency, direction: 'out', amount: money(amt, fromCur.minor_units),
      balanceAfter: newFrom, type: 'conversion', refConversionId: conversion.id, note, adminId: admin.id,
    });
    await insertTx(client, {
      caisseId, currency: toCurrency, direction: 'in', amount: money(toAmount, toCur.minor_units),
      balanceAfter: newTo, type: 'conversion', refConversionId: conversion.id, note, adminId: admin.id,
    });

    await writeAudit(client, {
      adminId: admin.id, action: 'caisse.convert', entity: 'conversion', entityId: conversion.id,
      details: {
        caisseId, fromCurrency, toCurrency, from_amount: money(amt, fromCur.minor_units),
        to_amount: money(toAmount, toCur.minor_units), dzd_value: money(dzdValue, DZD_SCALE),
        from_rate_dzd: fromRate, to_rate_dzd: toRateDzd.toFixed(8),
        ...(directRate ? { taux_paire: String(directRate) } : {}),
      }, ip,
    });

    return {
      conversion,
      balances: { [fromCurrency]: newFrom, [toCurrency]: newTo },
    };
  });
}

// The instant caisse-to-caisse transfer that used to live here is gone. Every
// caisse belongs to exactly one office, so a transfer between two caisses IS a
// transfer between two offices — one feature, not two — and it must not move
// money before the receiving side confirms it. See modules/transfers.

