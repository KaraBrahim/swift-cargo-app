// Une fiche par personne. Les rôles — fournisseur, passager — sont deux cases à
// cocher sur la même ligne, pas deux tables : le même homme peut vendre la
// marchandise et la transporter, et il n'a alors qu'un nom, qu'un téléphone et
// qu'un solde.
import { getPool, withTx } from '../../db/pool.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { deliverableLines } from '../orders/orderStatus.js';
import { applyDelivery } from '../orders/orders.service.js';

// `role` filtre la liste sans découper les données : la page Fournisseurs et la
// page Passagers sont deux vues de la même table, et une personne qui tient les
// deux rôles apparaît dans les deux.
export async function listPeople({ role, search, passagerType, includeInactive } = {}) {
  const params = [];
  const conds = [];
  if (!includeInactive) conds.push('active = TRUE');
  if (role === 'fournisseur') conds.push('is_fournisseur = TRUE');
  if (role === 'passager') conds.push('is_passager = TRUE');
  if (passagerType) {
    params.push(passagerType);
    conds.push(`passager_type = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conds.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length})`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await getPool().query(`SELECT * FROM people ${where} ORDER BY name`, params);
  return rows;
}

export async function getPerson(id, client = getPool()) {
  const { rows } = await client.query('SELECT * FROM people WHERE id = $1', [id]);
  if (!rows[0]) throw errors.notFound('Personne introuvable.');
  return rows[0];
}

// Le rôle passager porte un type (régulier / auto-entrepreneur) ; sans ce rôle
// il n'a pas de sens et la colonne reste vide plutôt que de garder une valeur
// que rien ne lit.
const passagerTypeFor = (data) => (data.isPassager ? data.passagerType || 'regular' : null);

export async function createPerson({ admin, data, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO people (name, phone, notes, is_fournisseur, is_passager, passager_type)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [data.name, data.phone ?? null, data.notes ?? null,
       Boolean(data.isFournisseur), Boolean(data.isPassager), passagerTypeFor(data)]
    );
    await writeAudit(c, {
      adminId: admin.id, action: 'person.create', entity: 'person', entityId: rows[0].id,
      details: { name: data.name, roles: rolesOf(rows[0]) }, ip,
    });
    return rows[0];
  });
}

export async function updatePerson({ admin, id, data, ip }) {
  return withTx(async (c) => {
    const before = await getPerson(id, c);
    const { rows } = await c.query(
      `UPDATE people SET name=$2, phone=$3, notes=$4, is_fournisseur=$5, is_passager=$6, passager_type=$7
        WHERE id=$1 RETURNING *`,
      [id, data.name, data.phone ?? null, data.notes ?? null,
       Boolean(data.isFournisseur), Boolean(data.isPassager), passagerTypeFor(data)]
    );
    // Retirer un rôle ne supprime pas ce qui a été fait sous ce rôle : les bons
    // et les écritures restent, ils appartiennent à la personne.
    await writeAudit(c, {
      adminId: admin.id, action: 'person.update', entity: 'person', entityId: Number(id),
      details: { name: data.name, roles: rolesOf(rows[0]), rolesAvant: rolesOf(before) }, ip,
    });
    return rows[0];
  });
}

export async function setPersonActive({ admin, id, active, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('UPDATE people SET active=$2 WHERE id=$1 RETURNING *', [id, active]);
    if (!rows[0]) throw errors.notFound('Personne introuvable.');
    await writeAudit(c, {
      adminId: admin.id, action: active ? 'person.activate' : 'person.deactivate',
      entity: 'person', entityId: Number(id), details: { name: rows[0].name }, ip,
    });
    return rows[0];
  });
}

const rolesOf = (p) => [p.is_fournisseur && 'fournisseur', p.is_passager && 'passager'].filter(Boolean);

// ── Le comptoir : « qu'est-ce qui m'attend ? » ───────────────────────
//
// Un bon passager transporte délibérément les lots de PLUSIEURS fournisseurs —
// une valise se remplit là où la marchandise est prête. La remise, elle, ne
// vivait que sur la fiche d'UN ordre. Quand l'homme se présente au comptoir,
// personne ne pouvait donc répondre à la seule question qu'il pose : ce qui est
// à moi, où qu'il soit arrivé.
// `client` n'est pas un détail : appelée depuis la transaction de la remise,
// elle doit lire ce que CETTE transaction vient d'écrire. Sur le pool, elle
// lirait l'état d'avant le commit et répondrait au comptoir que la marchandise
// attend encore.
export async function deliverableFor(personId, client = getPool()) {
  const person = await getPerson(personId, client);
  const lines = (await deliverableLines(client, { personId }))
    .filter((l) => Number(l.deliverable) > 0);

  // Groupées par ordre, dans l'ordre où elles sont arrivées : c'est aussi
  // l'ordre dans lequel on vide les étagères.
  const byOrder = new Map();
  for (const l of lines) {
    if (!byOrder.has(l.order_id)) {
      byOrder.set(l.order_id, { orderId: l.order_id, reference: l.order_reference, lines: [] });
    }
    byOrder.get(l.order_id).lines.push(l);
  }
  return { person, orders: [...byOrder.values()], total: lines.length };
}

// Une remise, une transaction — même si elle vide quatre ordres. Quatre appels
// séparés laisseraient le troisième échouer avec les deux premiers déjà sortis
// du stock, et personne au comptoir pour s'en apercevoir.
export async function deliverToPerson({ admin, personId, lines, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT id, name FROM people WHERE id=$1 AND active=TRUE', [personId]);
    const person = rows[0];
    if (!person) throw errors.notFound('Personne introuvable ou inactive.');

    const { moved, orders } = await applyDelivery(c, {
      admin, lines,
      allow: { personId: Number(personId) },
      note: `Remise au comptoir — ${person.name}`,
    });
    await writeAudit(c, {
      adminId: admin.id, action: 'person.deliver', entity: 'person', entityId: Number(personId),
      details: { name: person.name, lignes: moved, ordres: orders.length }, ip,
    });
    return deliverableFor(personId, c);
  });
}
