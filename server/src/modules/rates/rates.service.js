import { getPool, withTx } from '../../db/pool.js';
import { errors } from '../../lib/AppError.js';
import { Decimal, roundTo } from '../../lib/money.js';
import { writeAudit } from '../../lib/audit.js';

// ── ALP follows CNY ──────────────────────────────────────────────────
// Alipay yuan and cash yuan are the same money in this business, so keeping two
// numbers in step by hand is just a way to eventually get them out of step.
// Declared here rather than in settings.routes.js because this module is what
// enforces it; settings.routes.js imports the shape from here, the same way it
// imports PRINT_DEFAULTS from the printing module.
export const TAUX_DEFAULTS = { alp_suit_cny: true };
const LINK_SOURCE = 'CNY';
const LINK_TARGET = 'ALP';

export async function alpFollowsCny(client = getPool()) {
  const { rows } = await client.query("SELECT value FROM app_settings WHERE key = 'taux'");
  return rows[0]?.value?.alp_suit_cny ?? TAUX_DEFAULTS.alp_suit_cny;
}

const latestRate = async (client, codes) => {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (currency_code) currency_code, dzd_per_unit
       FROM exchange_rates WHERE currency_code = ANY($1)
      ORDER BY currency_code, created_at DESC, id DESC`,
    [codes]
  );
  return Object.fromEntries(rows.map((r) => [r.currency_code, r.dzd_per_unit]));
};

// Write ALP at the CNY value. Used when CNY changes and when the link is
// switched on — so the state after the switch matches what the switch claims.
async function writeAlpFromCny(client, { adminId, ip, cnyValue }) {
  const current = await latestRate(client, [LINK_SOURCE, LINK_TARGET]);
  const value = cnyValue ?? current[LINK_SOURCE];
  if (value == null) return null;
  if (current[LINK_TARGET] != null && new Decimal(current[LINK_TARGET]).eq(value)) return null;

  const { rows } = await client.query(
    `INSERT INTO exchange_rates (currency_code, dzd_per_unit, set_by, note)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [LINK_TARGET, value, adminId, 'Suit le CNY']
  );
  await writeAudit(client, {
    adminId, action: 'rate.set', entity: 'currency', entityId: LINK_TARGET,
    details: { dzd_per_unit: value, note: 'Suit le CNY' }, ip,
  });
  return rows[0];
}

// Called by settings.routes.js when the toggle is saved.
export const alignAlpToCny = (client, opts) => writeAlpFromCny(client, opts);

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

// A black-market rate is only meaningful together with WHEN it was set and by
// WHOM. getCurrentRates() returns bare numbers for the conversion maths; the
// screen needs the provenance too, or a placeholder seeded months ago looks
// exactly like a rate someone checked this morning.
export async function listCurrencies() {
  const linked = await alpFollowsCny();
  const [{ rows: currencies }, { rows: latest }] = await Promise.all([
    getPool().query('SELECT * FROM currencies ORDER BY sort_order'),
    getPool().query(
      `SELECT DISTINCT ON (r.currency_code)
              r.currency_code, r.dzd_per_unit, r.note, r.created_at, a.full_name AS set_by_name, a.role AS set_by_role
         FROM exchange_rates r
         LEFT JOIN admins a ON a.id = r.set_by
        ORDER BY r.currency_code, r.created_at DESC, r.id DESC`
    ),
  ]);
  const byCode = Object.fromEntries(latest.map((r) => [r.currency_code, r]));
  return currencies.map((c) => {
    const r = byCode[c.code];
    return {
      ...c,
      dzd_per_unit: r?.dzd_per_unit ?? null,
      rate_note: r?.note ?? null,
      rate_set_at: r?.created_at ?? null,
      // No admin recorded means nobody set it: it came from the seed.
      rate_set_by: r?.set_by_name ?? null,
      // DZD = 1 is true by definition, never a placeholder to be corrected.
      rate_is_seed: !c.is_base && Boolean(r) && r.note === 'seed',
      // Set on ALP while the link is on: the page draws a badge instead of a pen.
      linked_to: linked && c.code === LINK_TARGET ? LINK_SOURCE : null,
    };
  });
}

export async function setRate({ admin, currencyCode, dzdPerUnit, note, ip }) {
  const { rows } = await getPool().query('SELECT * FROM currencies WHERE code = $1', [currencyCode]);
  const currency = rows[0];
  if (!currency) throw errors.notFound(`Devise inconnue : ${currencyCode}.`);
  if (currency.is_base) {
    throw errors.conflict('Le taux de la devise de base (DZD) est fixé à 1 et non modifiable.');
  }

  return withTx(async (client) => {
    const linked = await alpFollowsCny(client);
    // The interface hides ALP's pen while the link is on, but a rule that only
    // lives in the interface is not a rule.
    if (linked && currencyCode === LINK_TARGET) {
      throw errors.conflict('ALP suit le CNY. Modifiez le CNY, ou désactivez le lien dans Paramètres.');
    }

    const ins = await client.query(
      `INSERT INTO exchange_rates (currency_code, dzd_per_unit, set_by, note)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [currencyCode, dzdPerUnit, admin.id, note ?? null]
    );
    // Same transaction: the two rates can never be seen disagreeing, not even
    // by a request that lands between them.
    const alp = linked && currencyCode === LINK_SOURCE
      ? await writeAlpFromCny(client, { adminId: admin.id, ip, cnyValue: dzdPerUnit })
      : null;

    await writeAudit(client, {
      adminId: admin.id, action: 'rate.set', entity: 'currency', entityId: currencyCode,
      details: { dzd_per_unit: dzdPerUnit, note: note ?? null, ...(alp ? { alp_aligne: dzdPerUnit } : {}) }, ip,
    });
    return ins.rows[0];
  });
}

export async function rateHistory(currencyCode) {
  const { rows } = await getPool().query(
    `SELECT er.*, a.full_name AS set_by_name, a.role AS set_by_role
       FROM exchange_rates er
       LEFT JOIN admins a ON a.id = er.set_by
      WHERE currency_code = $1
      ORDER BY er.created_at DESC, er.id DESC
      LIMIT 200`,
    [currencyCode]
  );
  return rows;
}

// ── Currency pairs ───────────────────────────────────────────────────
// A pair is a price in its own right: the USD/CNY street rate is quoted on its
// own and is not the quotient of two dinar rates. A new pair starts `derive` —
// computed live, so it can never go stale while nobody looks at it — and flips
// to `manuel` the first time someone types a price. Only a `manuel` pair changes
// what a conversion charges.
const crossRate = (fromDzd, toDzd) =>
  fromDzd == null || toDzd == null || new Decimal(toDzd).lte(0)
    ? null
    : roundTo(new Decimal(fromDzd).div(toDzd), 8).toString();

export async function listPairs(client = getPool()) {
  const [{ rows: pairs }, { rows: values }] = await Promise.all([
    client.query(
      `SELECT p.*, a.full_name AS created_by_name, a.role AS created_by_role
         FROM currency_pairs p LEFT JOIN admins a ON a.id = p.created_by
        ORDER BY p.from_code, p.to_code`
    ),
    client.query(
      `SELECT DISTINCT ON (r.from_code, r.to_code)
              r.from_code, r.to_code, r.units_per_unit, r.note, r.created_at,
              a.full_name AS set_by_name, a.role AS set_by_role
         FROM pair_rates r LEFT JOIN admins a ON a.id = r.set_by
        ORDER BY r.from_code, r.to_code, r.created_at DESC, r.id DESC`
    ),
  ]);
  if (!pairs.length) return [];

  const dzd = await latestRate(client, [...new Set(pairs.flatMap((p) => [p.from_code, p.to_code]))]);
  const byKey = Object.fromEntries(values.map((v) => [`${v.from_code}>${v.to_code}`, v]));

  return pairs.map((p) => {
    const v = byKey[`${p.from_code}>${p.to_code}`];
    const derived = crossRate(dzd[p.from_code], dzd[p.to_code]);
    return {
      ...p,
      derived_rate: derived,
      manual_rate: v?.units_per_unit ?? null,
      // What the pair is worth right now, by whichever rule it follows.
      rate: p.mode === 'manuel' ? v?.units_per_unit ?? derived : derived,
      rate_set_at: p.mode === 'manuel' ? v?.created_at ?? null : null,
      rate_set_by: p.mode === 'manuel' ? v?.set_by_name ?? null : null,
      rate_note: p.mode === 'manuel' ? v?.note ?? null : null,
    };
  });
}

const loadCurrency = async (client, code) => {
  const { rows } = await client.query('SELECT * FROM currencies WHERE code = $1', [code]);
  if (!rows[0]) throw errors.notFound(`Devise inconnue : ${code}.`);
  return rows[0];
};

export async function addPair({ admin, fromCode, toCode, ip }) {
  if (fromCode === toCode) throw errors.validation([{ field: 'toCode', message: 'Deux devises différentes sont requises.' }]);
  return withTx(async (client) => {
    await loadCurrency(client, fromCode);
    await loadCurrency(client, toCode);
    const { rows } = await client.query(
      `INSERT INTO currency_pairs (from_code, to_code, created_by) VALUES ($1,$2,$3)
       ON CONFLICT (from_code, to_code) DO NOTHING RETURNING *`,
      [fromCode, toCode, admin.id]
    );
    if (!rows[0]) throw errors.conflict('Cette paire existe déjà.');
    await writeAudit(client, {
      adminId: admin.id, action: 'pair.create', entity: 'currency_pair',
      entityId: `${fromCode}>${toCode}`, details: { from: fromCode, to: toCode }, ip,
    });
    return rows[0];
  });
}

// Typing a price is what turns a computed pair into a quoted one.
export async function setPairRate({ admin, fromCode, toCode, unitsPerUnit, note, ip }) {
  return withTx(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM currency_pairs WHERE from_code=$1 AND to_code=$2 FOR UPDATE',
      [fromCode, toCode]
    );
    if (!rows[0]) throw errors.notFound('Paire introuvable.');
    if (!(Number(unitsPerUnit) > 0)) throw errors.invalidAmount('Le taux doit être supérieur à zéro.');

    const ins = await client.query(
      `INSERT INTO pair_rates (from_code, to_code, units_per_unit, set_by, note)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [fromCode, toCode, unitsPerUnit, admin.id, note ?? null]
    );
    await client.query(
      "UPDATE currency_pairs SET mode='manuel' WHERE from_code=$1 AND to_code=$2",
      [fromCode, toCode]
    );
    await writeAudit(client, {
      adminId: admin.id, action: 'pair.set', entity: 'currency_pair',
      entityId: `${fromCode}>${toCode}`, details: { rate: unitsPerUnit, note: note ?? null }, ip,
    });
    return ins.rows[0];
  });
}

// Back to the computed value. The typed history is kept — it is what the rate
// WAS, and the period card still reads it.
export async function resetPair({ admin, fromCode, toCode, ip }) {
  return withTx(async (client) => {
    const { rows } = await client.query(
      "UPDATE currency_pairs SET mode='derive' WHERE from_code=$1 AND to_code=$2 RETURNING *",
      [fromCode, toCode]
    );
    if (!rows[0]) throw errors.notFound('Paire introuvable.');
    await writeAudit(client, {
      adminId: admin.id, action: 'pair.reset', entity: 'currency_pair',
      entityId: `${fromCode}>${toCode}`, details: { mode: 'derive' }, ip,
    });
    return rows[0];
  });
}

export async function deletePair({ admin, fromCode, toCode, ip }) {
  return withTx(async (client) => {
    const { rows } = await client.query(
      'DELETE FROM currency_pairs WHERE from_code=$1 AND to_code=$2 RETURNING *',
      [fromCode, toCode]
    );
    if (!rows[0]) throw errors.notFound('Paire introuvable.');
    await writeAudit(client, {
      adminId: admin.id, action: 'pair.delete', entity: 'currency_pair',
      entityId: `${fromCode}>${toCode}`, details: { from: fromCode, to: toCode }, ip,
    });
    return { deleted: true };
  });
}

// The one function the conversion engine calls: the direct price for this
// direction, or null to keep routing through the dinar. A pair is directional —
// adding USD>CNY does not quote CNY>USD, because inverting a black-market price
// invents a spread nobody offered.
export async function directRateFor(client, fromCode, toCode) {
  const { rows } = await client.query(
    `SELECT r.units_per_unit
       FROM currency_pairs p
       JOIN pair_rates r ON r.from_code = p.from_code AND r.to_code = p.to_code
      WHERE p.from_code = $1 AND p.to_code = $2 AND p.mode = 'manuel'
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
    [fromCode, toCode]
  );
  return rows[0]?.units_per_unit ?? null;
}

// ── What a pair was worth on a date, and on average over a period ────
// Everything here reads the append-only histories, which is why editing a rate
// must keep recording rows rather than overwriting one.
const asOf = async (client, codes, when) => {
  const [{ rows }, { rows: base }] = await Promise.all([
    client.query(
      `SELECT DISTINCT ON (currency_code) currency_code, dzd_per_unit
         FROM exchange_rates
        WHERE currency_code = ANY($1) AND created_at <= $2
        ORDER BY currency_code, created_at DESC, id DESC`,
      [codes, when]
    ),
    client.query('SELECT code FROM currencies WHERE is_base AND code = ANY($1)', [codes]),
  ]);
  const map = Object.fromEntries(rows.map((r) => [r.currency_code, r.dzd_per_unit]));
  // The dinar is 1 on every date there has ever been. It does have a seeded row,
  // but that row is dated when the database was created — so asking what a rate
  // was BEFORE that day would otherwise answer "unknown" about the one currency
  // whose value is a definition. The conversion engine already treats it this
  // way (`fromCur.is_base ? '1'`).
  for (const b of base) map[b.code] = '1';
  return map;
};

const pairAsOf = async (client, from, to, when) => {
  const { rows } = await client.query(
    `SELECT units_per_unit FROM pair_rates
      WHERE from_code=$1 AND to_code=$2 AND created_at <= $3
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [from, to, when]
  );
  return rows[0]?.units_per_unit ?? null;
};

const isManual = async (client, from, to) => {
  const { rows } = await client.query(
    "SELECT 1 FROM currency_pairs WHERE from_code=$1 AND to_code=$2 AND mode='manuel'",
    [from, to]
  );
  return rows.length > 0;
};

// Every moment the rate changed inside the window, as {at, rate} — starting
// with whatever was already in force when the window opened.
async function series(client, from, to, start, end) {
  const manual = await isManual(client, from, to);

  if (manual) {
    const opening = await pairAsOf(client, from, to, start);
    const { rows } = await client.query(
      `SELECT units_per_unit AS rate, created_at AS at FROM pair_rates
        WHERE from_code=$1 AND to_code=$2 AND created_at > $3 AND created_at <= $4
        ORDER BY created_at, id`,
      [from, to, start, end]
    );
    const points = rows.map((r) => ({ at: r.at, rate: String(r.rate) }));
    return opening != null ? [{ at: start, rate: String(opening) }, ...points] : points;
  }

  // Derived: the cross moves whenever EITHER leg moves.
  const opening = await asOf(client, [from, to], start);
  const { rows } = await client.query(
    `SELECT currency_code, dzd_per_unit, created_at AS at FROM exchange_rates
      WHERE currency_code = ANY($1) AND created_at > $2 AND created_at <= $3
      ORDER BY created_at, id`,
    [[from, to], start, end]
  );
  const live = { ...opening };
  const points = [];
  const push = (at) => {
    const rate = from === to ? '1' : crossRate(live[from], live[to]);
    if (rate != null) points.push({ at, rate });
  };
  push(start);
  for (const r of rows) {
    live[r.currency_code] = r.dzd_per_unit;
    push(r.at);
  }
  return points;
}

// Weighted by how long each rate stood: a rate that held for twenty days counts
// twenty times a rate corrected an hour later. A plain average of the values
// entered would say something no money was ever converted at.
function weightedAverage(points, end) {
  if (!points.length) return null;
  let total = new Decimal(0);
  let span = new Decimal(0);
  for (let i = 0; i < points.length; i++) {
    const from = new Date(points[i].at).getTime();
    const to = i + 1 < points.length ? new Date(points[i + 1].at).getTime() : new Date(end).getTime();
    // Two changes in the same second: no duration, but the value still happened.
    const ms = Math.max(to - from, 0);
    total = total.plus(new Decimal(points[i].rate).mul(ms));
    span = span.plus(ms);
  }
  if (span.lte(0)) {
    const sum = points.reduce((a, p) => a.plus(p.rate), new Decimal(0));
    return roundTo(sum.div(points.length), 8).toString();
  }
  return roundTo(total.div(span), 8).toString();
}

export async function lookup({ from, to, date, start, end }, client = getPool()) {
  if (from === to) throw errors.validation([{ field: 'to', message: 'Choisissez deux devises différentes.' }]);

  // One date: what the rate was that day, at the end of it.
  if (date) {
    const when = new Date(`${date}T23:59:59.999Z`);
    let rate;
    if (await isManual(client, from, to)) {
      rate = await pairAsOf(client, from, to, when);
    } else {
      const legs = await asOf(client, [from, to], when);
      rate = crossRate(legs[from], legs[to]);
    }
    // null, not zero: "no rate known that day" is not "the rate was nothing".
    return { from, to, date, rate: rate == null ? null : String(rate) };
  }

  const startAt = new Date(`${start}T00:00:00.000Z`);
  const endAt = new Date(`${end}T23:59:59.999Z`);
  if (endAt < startAt) throw errors.validation([{ field: 'end', message: 'La date de fin précède la date de début.' }]);

  const points = await series(client, from, to, startAt, endAt);
  const first = points[0]?.rate ?? null;
  const last = points[points.length - 1]?.rate ?? null;
  const changePct = first && last && Number(first) > 0
    ? roundTo(new Decimal(last).minus(first).div(first).mul(100), 2).toString()
    : null;

  return {
    from, to, start, end,
    points: points.map((p) => ({ date: p.at, rate: p.rate })),
    average: weightedAverage(points, endAt),
    first, last, changePct,
  };
}
