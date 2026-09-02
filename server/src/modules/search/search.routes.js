// Global search behind the ⌘K / Ctrl-K palette. Fans out across the five things
// a cashier looks up by name or reference, capped per group so one noisy entity
// can never crowd out the others.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { getPool } from '../../db/pool.js';

export const searchRouter = Router();
searchRouter.use(requireAuth);

const PER_GROUP = 5;

searchRouter.get(
  '/search',
  validate({ query: z.object({ q: z.string().trim().min(1).max(64) }) }),
  asyncHandler(async (req, res) => {
    const like = `%${req.validatedQuery.q}%`;
    const db = getPool();

    const [bons, orders, fournisseurs, passagers, items] = await Promise.all([
      db.query(
        `SELECT b.id, b.reference, b.status, f.name AS fournisseur_name
           FROM bons b JOIN fournisseurs f ON f.id = b.fournisseur_id
          WHERE b.reference ILIKE $1 OR f.name ILIKE $1
          ORDER BY b.created_at DESC LIMIT $2`,
        [like, PER_GROUP]
      ),
      db.query(
        `SELECT o.id, o.reference, o.status, f.name AS fournisseur_name
           FROM orders o JOIN fournisseurs f ON f.id = o.fournisseur_id
          WHERE o.reference ILIKE $1 OR f.name ILIKE $1
          ORDER BY o.created_at DESC LIMIT $2`,
        [like, PER_GROUP]
      ),
      db.query(
        `SELECT id, name, phone, city FROM fournisseurs
          WHERE active = TRUE AND (name ILIKE $1 OR phone ILIKE $1)
          ORDER BY name LIMIT $2`,
        [like, PER_GROUP]
      ),
      db.query(
        `SELECT id, full_name, phone, type FROM passagers
          WHERE active = TRUE AND (full_name ILIKE $1 OR phone ILIKE $1)
          ORDER BY full_name LIMIT $2`,
        [like, PER_GROUP]
      ),
      db.query(
        `SELECT i.id, i.name, i.quantity, c.name AS category_name
           FROM stock_items i LEFT JOIN stock_categories c ON c.id = i.category_id
          WHERE i.active = TRUE AND i.name ILIKE $1
          ORDER BY i.name LIMIT $2`,
        [like, PER_GROUP]
      ),
    ]);

    const groups = [
      { key: 'bons', label: 'Bons passagers', icon: 'bon',
        results: bons.rows.map((r) => ({ id: r.id, title: r.reference, sub: r.fournisseur_name, href: `/bons-passager/${r.id}` })) },
      { key: 'ordres', label: 'Bons fournisseurs', icon: 'order',
        results: orders.rows.map((r) => ({ id: r.id, title: r.reference, sub: r.fournisseur_name, href: `/bons-fournisseur/${r.id}` })) },
      { key: 'fournisseurs', label: 'Fournisseurs', icon: 'fournisseur',
        results: fournisseurs.rows.map((r) => ({ id: r.id, title: r.name, sub: r.city || r.phone || '', href: `/fournisseurs/${r.id}` })) },
      { key: 'passagers', label: 'Passagers', icon: 'passager',
        results: passagers.rows.map((r) => ({ id: r.id, title: r.full_name, sub: r.type === 'auto' ? 'Auto-entrepreneur' : 'Régulier', href: `/passagers/${r.id}` })) },
      { key: 'stock', label: 'Stock', icon: 'stock',
        results: items.rows.map((r) => ({ id: r.id, title: r.name, sub: r.category_name || 'Sans catégorie', href: '/stock' })) },
    ].filter((g) => g.results.length);

    res.json({ groups, total: groups.reduce((n, g) => n + g.results.length, 0) });
  })
);
