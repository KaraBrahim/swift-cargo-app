import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { getPool } from '../../db/pool.js';

export const auditRouter = Router();
auditRouter.use(requireAuth);

auditRouter.get(
  '/audit',
  validate({
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
      action: z.string().trim().max(64).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { limit = 100, action } = req.validatedQuery;
    const params = [limit];
    let where = '';
    if (action) {
      params.push(action);
      where = `WHERE al.action = $${params.length}`;
    }
    const { rows } = await getPool().query(
      `SELECT al.*, a.full_name AS admin_name
         FROM audit_log al LEFT JOIN admins a ON a.id = al.admin_id
         ${where}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT $1`,
      params
    );
    res.json({ entries: rows });
  })
);
