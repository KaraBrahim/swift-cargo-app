import { getPool, withTx } from '../../db/pool.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';

// Current rate = latest exchange_rates row per currency. Uses DISTINCT ON.
export async function getCurrentRates(client = getPool()) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (currency_code) currency_code, dzd_per_unit, created_at
       FROM exchange_rates
      ORDER BY currency_code, created_at DESC, id DESC`
  );
  const map = {};
  for (const r of rows) map[r.currency_code] = r.dzd_per_unit;
  return map;
}

export async function listCurrencies() {
  const [{ rows: currencies }, rates] = await Promise.all([
    getPool().query('SELECT * FROM currencies ORDER BY sort_order'),
    getCurrentRates(),
  ]);
  return currencies.map((c) => ({ ...c, dzd_per_unit: rates[c.code] ?? null }));
}

export async function setRate({ admin, currencyCode, dzdPerUnit, note, ip }) {
  const { rows } = await getPool().query('SELECT * FROM currencies WHERE code = $1', [currencyCode]);
  const currency = rows[0];
  if (!currency) throw errors.notFound(`Devise inconnue : ${currencyCode}.`);
  if (currency.is_base) {
    throw errors.conflict('Le taux de la devise de base (DZD) est fixé à 1 et non modifiable.');
  }

  return withTx(async (client) => {
    const ins = await client.query(
      `INSERT INTO exchange_rates (currency_code, dzd_per_unit, set_by, note)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [currencyCode, dzdPerUnit, admin.id, note ?? null]
    );
    await writeAudit(client, {
      adminId: admin.id, action: 'rate.set', entity: 'currency', entityId: currencyCode,
      details: { dzd_per_unit: dzdPerUnit, note: note ?? null }, ip,
    });
    return ins.rows[0];
  });
}

export async function rateHistory(currencyCode) {
  const { rows } = await getPool().query(
    `SELECT er.*, a.full_name AS set_by_name
       FROM exchange_rates er
       LEFT JOIN admins a ON a.id = er.set_by
      WHERE currency_code = $1
      ORDER BY er.created_at DESC, er.id DESC
      LIMIT 200`,
    [currencyCode]
  );
  return rows;
}
