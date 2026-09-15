import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { getPool } from '../../db/pool.js';
import { notSuperadmin, isSuperadmin } from '../../lib/visibility.js';

export const auditRouter = Router();

// Every action is named `<domain>.<verb>`, so the domain already IS the
// category — no extra column needed, just a prefix match. Kept here rather than
// on the page so the database does the filtering, and the row limit applies to
// the category you asked for instead of to everything.
const CATEGORIES = {
  connexion: ['auth.%'],
  caisse: ['caisse.%', 'person.transaction', 'payment.%'],
  bons: ['bon.%', 'order.%'],
  transferts: ['transfer.%'],
  stock: ['stock.%'],
  charges: ['charge.%'],
  taux: ['rate.%'],
  repertoire: ['fournisseur.%', 'passager.%'],
  utilisateurs: ['admin.%'],
  systeme: ['settings.%', 'print.%'],
};

auditRouter.get(
  '/audit',
  validate({
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
      action: z.string().trim().max(64).optional(),
      category: z.enum(Object.keys(CATEGORIES)).optional(),
      search: z.string().trim().max(80).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { limit = 100, action, category, search } = req.validatedQuery;
    const params = [limit];
    const clauses = [];

    if (action) {
      params.push(action);
      clauses.push(`al.action = $${params.length}`);
    }
    if (category) {
      params.push(CATEGORIES[category]);
      clauses.push(`al.action LIKE ANY($${params.length}::text[])`);
    }
    if (search) {
      // Free text over who did it and what it touched — the entity reference is
      // inside the JSON payload, so that is cast to text and searched too.
      params.push(`%${search}%`);
      const i = params.length;
      clauses.push(
        `(a.full_name ILIKE $${i} OR al.action ILIKE $${i} OR al.entity_id ILIKE $${i} OR al.details::text ILIKE $${i})`
      );
    }

    // What a normal admin must not see, in one place so the rows and the chip
    // counts below can never disagree:
    //
    //   - the super-admin's own actions, the whole journal through;
    //   - every failed sign-in, whoever it names. An attempt records the account
    //     it targeted, so leaving them in would say "someone tried the
    //     super-admin account" — the exact thing being hidden — and an attempt
    //     on an unknown name is not something a normal admin can act on anyway.
    //     The super-admin still sees all of them.
    const restriction = isSuperadmin(req.admin)
      ? null
      : `${notSuperadmin('al.admin_id')} AND al.action <> 'auth.login_failed'`;
    if (restriction) clauses.push(restriction);

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await getPool().query(
      `SELECT al.*, a.full_name AS admin_name, a.role AS admin_role
         FROM audit_log al LEFT JOIN admins a ON a.id = al.admin_id
         ${where}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT $1`,
      params
    );

    // Counts per category for the filter chips, always over the whole log so a
    // filtered view still shows what else is there.
    const { rows: counts } = await getPool().query(
      `SELECT split_part(action, '.', 1) AS domain, count(*)::int AS n
         FROM audit_log al
        ${restriction ? `WHERE ${restriction}` : ''}
        GROUP BY 1`
    );
    res.json({ entries: rows, counts });
  })
);
