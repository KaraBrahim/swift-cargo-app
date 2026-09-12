// Les rapports répondent à une PLAGE DE JOURS, pas à une fenêtre glissante.
// Avant, « ce mois » valait `now() - '30 days'` : au 8 septembre, on obtenait
// du 9 août au 8 septembre. Septembre était inaccessible.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse } from './helpers/testdb.js';
import * as reports from '../src/modules/reports/reports.service.js';
import { parseRange, monthToDate, reportTz } from '../src/lib/dates.js';
import { getPool } from '../src/db/pool.js';

let db, ctx, caisseId;

// `node --test` lance les fichiers en PARALLÈLE contre la même base. Ces
// rapports agrègent tout ce qui existe : sans isolation, les dépôts d'un autre
// fichier tombent dans la plage testée ici et les totaux deviennent du hasard.
// D'où une caisse à soi et une devise que personne d'autre ne bouge — ALP n'est
// touchée nulle part ailleurs, et tous ces rapports sont bornés par devise.
const CUR = 'ALP';

// Des mouvements posés à la main dans le passé : la seule façon de vérifier une
// frontière de mois sans attendre un mois. Type « order_fee » : un vrai
// encaissement de l'activité — un « deposit » est l'argent du patron, et le
// rapport l'exclut justement des entrées.
async function seedAt(when, direction, amount) {
  const { rows } = await getPool().query(
    `INSERT INTO transactions (caisse_id, currency_code, direction, amount, balance_after, type, admin_id, created_at)
     VALUES ($1,$2,$3,$4,0,'order_fee',$5,$6) RETURNING id`,
    [caisseId, CUR, direction, amount, ctx.admin.id, when]
  );
  return rows[0].id;
}

before(async () => {
  db = await setupTestDb();
  ctx = await firstAdminAndCaisse();
  const c = await getPool().query(
    `INSERT INTO caisses (kind, office, label) VALUES ('office', NULL, 'Caisse rapports (test)') RETURNING id`
  );
  caisseId = c.rows[0].id;
});
after(async () => { await db.stop(); });

// ── La plage elle-même ──────────────────────────────────────────────
test('parseRange defaults to the current month up to today', () => {
  const r = parseRange({});
  const m = monthToDate();
  assert.equal(r.from, m.from);
  assert.equal(r.to, m.to);
  assert.match(r.from, /^\d{4}-\d{2}-01$/, 'commence le 1er');
  assert.equal(r.tz, reportTz());
});

test('parseRange refuses a half-given range, a bad day and a reversed range', () => {
  assert.throws(() => parseRange({ from: '2026-09-01' }), (e) => e.code === 'VALIDATION');
  assert.throws(() => parseRange({ from: '2026-02-31', to: '2026-03-01' }), (e) => e.code === 'VALIDATION');
  assert.throws(() => parseRange({ from: '2026-09-10', to: '2026-09-01' }), (e) => e.code === 'VALIDATION');
});

// ── Le bug qui a motivé le changement ───────────────────────────────
test('a September range excludes an August movement', async () => {
  await seedAt('2026-08-20T10:00:00+01', 'in', '5000');
  await seedAt('2026-09-03T10:00:00+01', 'in', '700');

  const sept = await reports.financialSummary({ currency: CUR, from: '2026-09-01', to: '2026-09-30' });
  assert.equal(sept.entrees, '700.00', 'seul le mouvement de septembre compte');

  const aout = await reports.financialSummary({ currency: CUR, from: '2026-08-01', to: '2026-08-31' });
  assert.equal(aout.entrees, '5000.00');

  // Et la période est ANNONCÉE, pas devinée.
  assert.equal(sept.from, '2026-09-01');
  assert.equal(sept.to, '2026-09-30');
  assert.ok(sept.tzLabel, 'le rapport dit quelle horloge il a suivie');
});

// ── Les bornes ──────────────────────────────────────────────────────
test('the last day is included, the day after is not', async () => {
  const tz = reportTz();
  // 23:59:59 le dernier jour de la plage, dans le fuseau du bureau.
  const late = await getPool().query(
    `SELECT ('2026-10-08'::date + interval '23 hours 59 minutes 59 seconds')::timestamp
            AT TIME ZONE $1 AS t`, [tz]
  );
  const next = await getPool().query(
    `SELECT ('2026-10-09'::date)::timestamp AT TIME ZONE $1 AS t`, [tz]
  );
  await seedAt(late.rows[0].t, 'in', '11');
  await seedAt(next.rows[0].t, 'in', '22');

  const r = await reports.financialSummary({ currency: CUR, from: '2026-10-01', to: '2026-10-08' });
  assert.equal(r.entrees, '11.00', '23:59:59 du 8 est dedans, 00:00 du 9 est dehors');
});

// ── L'incohérence du rapport financier ──────────────────────────────
test('the parType rows add up to the headline', async () => {
  await seedAt('2026-11-05T10:00:00+01', 'in', '300');
  // Une conversion et un transfert ne font entrer aucun argent nouveau.
  await getPool().query(
    `INSERT INTO transactions (caisse_id, currency_code, direction, amount, balance_after, type, admin_id, created_at)
     VALUES ($1,'ALP','in','999',0,'conversion',$2,'2026-11-06T10:00:00+01'),
            ($1,'ALP','in','888',0,'transfer',$2,'2026-11-07T10:00:00+01')`,
    [caisseId, ctx.admin.id]
  );

  const r = await reports.financialSummary({ currency: CUR, from: '2026-11-01', to: '2026-11-30' });
  const sumRows = r.parType.reduce((a, x) => a + Number(x.entrees), 0);
  assert.equal(sumRows, Number(r.entrees), 'les lignes totalisent l’entête');
  assert.equal(r.entrees, '300.00', 'conversion et transfert exclus des deux côtés');
});

// ── L'à-nouveau ─────────────────────────────────────────────────────
test('a caisse statement opens where the previous period closed', async () => {
  const st = await reports.caisseStatement({ caisseId, currency: CUR, from: '2026-09-01', to: '2026-09-30' });
  // Août avait laissé 5 000 dans cette caisse.
  assert.equal(st.soldeOuverture, '5000.00');
  assert.equal(st.entrees, '700.00');
  const check = Number(st.soldeOuverture) + Number(st.entrees) - Number(st.depenses);
  assert.equal(Number(st.soldeCloture), check, 'ouverture + entrées − sorties = clôture');
});

test('a person statement is bounded and carries its own opening balance', async () => {
  const p = await getPool().query(
    "INSERT INTO people (name, is_fournisseur) VALUES ('Relevé Test', TRUE) RETURNING id"
  );
  const id = p.rows[0].id;
  await getPool().query(
    `INSERT INTO person_ledger (person_type, person_id, currency_code, amount, balance_after, type, admin_id, created_at)
     VALUES ('personne',$1,'ALP','-1000','-1000','transport_fee',$2,'2026-08-15T10:00:00+01'),
            ('personne',$1,'ALP','400','-600','fee_payment',$2,'2026-09-10T10:00:00+01')`,
    [id, ctx.admin.id]
  );

  const st = await reports.personStatement({ personId: id, currency: CUR, from: '2026-09-01', to: '2026-09-30' });
  assert.equal(st.entries.length, 1, 'seule l’écriture de septembre est listée');
  assert.equal(st.soldeOuverture, '-1000.00', 'ce que disait août');
  assert.equal(st.soldeCloture, '-600.00');
});

// ── Les rapports qui n'existaient pas ───────────────────────────────
test('the money report covers conversions, transfers and charges', async () => {
  const r = await reports.moneyReport({ currency: CUR, from: '2026-11-01', to: '2026-11-30' });
  assert.ok(Array.isArray(r.caisses));
  assert.ok(Array.isArray(r.conversions));
  assert.ok(Array.isArray(r.transferts));
  assert.ok(Array.isArray(r.charges));
  const c = r.caisses.find((x) => x.id === caisseId);
  assert.equal(
    Number(c.cloture),
    Number(c.ouverture) + Number(c.entrees) - Number(c.sorties),
    'chaque caisse se vérifie elle-même'
  );
});

test('the people and goods reports answer for a range', async () => {
  const p = await reports.peopleReport({ currency: CUR, from: '2026-09-01', to: '2026-09-30' });
  assert.equal(p.from, '2026-09-01');
  assert.ok(Array.isArray(p.rows));

  const g = await reports.goodsReport({ from: '2026-09-01', to: '2026-09-30' });
  assert.ok(Array.isArray(g.parStatut));
  assert.ok(Array.isArray(g.mouvements), 'les mouvements de stock ont enfin un rapport');
  assert.ok(g.enTransit, 'et ce qui est en route est un état, pas un flux');
});

// ── Le choix de la date ─────────────────────────────────────────────
test('a bon created in one month and settled in another is dated by the chosen column', async () => {
  const f = await getPool().query(
    "INSERT INTO people (name, is_fournisseur) VALUES ('F Dates', TRUE) RETURNING id"
  );
  const o = await getPool().query(
    `INSERT INTO orders (fournisseur_id, created_by, created_at, closed_at)
     VALUES ($1,$2,'2026-08-10T10:00:00+01','2026-09-20T10:00:00+01') RETURNING id, reference`,
    [f.rows[0].id, ctx.admin.id]
  );
  const ref = o.rows[0].reference;

  const creation = await reports.orderProfitability({ currency: CUR, from: '2026-08-01', to: '2026-08-31', dateBy: 'creation' });
  const reglement = await reports.orderProfitability({ currency: CUR, from: '2026-09-01', to: '2026-09-30', dateBy: 'reglement' });
  const croise = await reports.orderProfitability({ currency: CUR, from: '2026-09-01', to: '2026-09-30', dateBy: 'creation' });

  assert.ok(creation.rows.some((r) => r.reference === ref), 'créé en août');
  assert.ok(reglement.rows.some((r) => r.reference === ref), 'clôturé en septembre');
  assert.ok(!croise.rows.some((r) => r.reference === ref), 'jamais compté deux fois dans la même vue');
});

// ── Le tableau de bord : les quatre blocs « À surveiller » ───────────
//
// Ils sont faits de SQL écrit à la main — expressions corrélées, make_interval,
// agrégats filtrés. Rien dans le reste de la suite ne les exécute, et une faute
// de frappe dans une de ces requêtes ne se verrait qu'à l'ouverture de la page,
// en production. Ce test les fait simplement tourner contre une vraie base.
test('les agrégats « à surveiller » s’exécutent et ont la bonne forme', async () => {
  const dash = await import('../src/modules/dashboard/dashboard.service.js');

  const creances = await dash.receivables('DZD');
  assert.ok(Array.isArray(creances.debiteurs) && Array.isArray(creances.crediteurs));
  assert.equal(typeof creances.a_recevoir, 'string', 'les montants restent du texte, jamais des flottants');

  const aRegler = await dash.carriersToSettle();
  assert.ok(Array.isArray(aRegler.lignes));
  assert.equal(typeof aRegler.nb, 'number');

  const enAttente = await dash.goodsWaiting();
  assert.ok(Array.isArray(enAttente.lignes));

  const manquants = await dash.lossesByCarrier('DZD');
  assert.ok(Array.isArray(manquants.lignes));
  for (const l of manquants.lignes) {
    assert.ok(l.taux >= 0 && l.taux <= 100, 'un taux de manquants sort des bornes');
  }

  // Et le tout ensemble, comme la page le demande.
  const vue = await dash.overview({ period: 'mois', currency: 'DZD' });
  for (const key of ['receivables', 'carriersToSettle', 'goodsWaiting', 'lossesByCarrier']) {
    assert.ok(vue[key], `overview() ne renvoie pas ${key}`);
  }
});
