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

    const [bons, orders, people, items] = await Promise.all([
      // Bons PASSAGERS : order_id IS NULL. La ligne `bons` qu'un bon fournisseur
      // crée pour stocker sa marchandise n'est pas un document à retrouver ici.
      db.query(
        `SELECT b.id, b.reference, b.status, p.name AS passager_name
           FROM bons b LEFT JOIN people p ON p.id = b.passager_id
          WHERE b.order_id IS NULL AND (b.reference ILIKE $1 OR p.name ILIKE $1)
          ORDER BY b.created_at DESC LIMIT $2`,
        [like, PER_GROUP]
      ),
      db.query(
        `SELECT o.id, o.reference, o.status, f.name AS fournisseur_name
           FROM orders o JOIN people f ON f.id = o.fournisseur_id
          WHERE o.reference ILIKE $1 OR f.name ILIKE $1
          ORDER BY o.created_at DESC LIMIT $2`,
        [like, PER_GROUP]
      ),
      // Une personne, un résultat — quels que soient ses rôles.
      db.query(
        `SELECT id, name, phone, is_fournisseur, is_passager, passager_type FROM people
          WHERE active = TRUE AND (name ILIKE $1 OR phone ILIKE $1)
          ORDER BY name LIMIT $2`,
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
        results: bons.rows.map((r) => ({ id: r.id, title: r.reference, sub: r.passager_name || 'Sans passager', href: `/bons-passager/${r.id}` })) },
      { key: 'ordres', label: 'Bons fournisseurs', icon: 'order',
        results: orders.rows.map((r) => ({ id: r.id, title: r.reference, sub: r.fournisseur_name, href: `/bons-fournisseur/${r.id}` })) },
      { key: 'personnes', label: 'Personnes', icon: 'users',
        results: people.rows.map((r) => ({
          id: r.id, title: r.name,
          sub: [r.is_fournisseur && 'Fournisseur',
                r.is_passager && (r.passager_type === 'auto' ? 'Passager auto-entrepreneur' : 'Passager')]
            .filter(Boolean).join(' · '),
          href: `/personnes/${r.id}`,
        })) },
      { key: 'stock', label: 'Stock', icon: 'stock',
        results: items.rows.map((r) => ({ id: r.id, title: r.name, sub: r.category_name || 'Sans catégorie', href: '/stock' })) },
    ].filter((g) => g.results.length);

    res.json({ groups, total: groups.reduce((n, g) => n + g.results.length, 0) });
  })
);
