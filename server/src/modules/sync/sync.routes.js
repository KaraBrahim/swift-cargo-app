import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { getPool, withTx } from '../../db/pool.js';
import { config } from '../../config.js';
import { errors } from '../../lib/AppError.js';
import * as sync from './sync.service.js';

export const syncRouter = Router();

// Node-to-node auth for the hub endpoints.
//
// These serve raw row snapshots of the whole database, so "no token configured"
// must mean CLOSED, not open: on a public URL, allowing unauthenticated calls
// would let anyone GET /api/sync/pull and download the entire ledger without
// logging in. Only development keeps the convenience of running without one.
function requireNode(req, _res, next) {
  if (!config.nodeToken) {
    if (config.isProduction) {
      return next(errors.unauthorized("Synchronisation désactivée : NODE_TOKEN n'est pas défini sur ce serveur."));
    }
    return next();
  }
  if (req.get('x-node-token') !== config.nodeToken) {
    return next(errors.unauthorized('Jeton de nœud invalide.'));
  }
  next();
}

// Hub: receive a desk's pushed events.
syncRouter.post(
  '/sync/push',
  requireNode,
  validate({ body: z.object({ site: z.string(), events: z.array(z.object({
    uuid: z.string(), entity: z.string(), entity_uuid: z.string(),
    op: z.enum(['insert', 'update']), snapshot: z.any(), origin_site: z.string(),
  })) }) }),
  asyncHandler(async (req, res) => {
    const acked = await withTx((c) => sync.hubReceive(c, req.body.events));
    res.json({ acked });
  })
);

// Hub: serve events after a cursor.
syncRouter.get(
  '/sync/pull',
  requireNode,
  validate({ query: z.object({ since: z.coerce.number().int().min(0).default(0), excludeOrigin: z.string().optional(), limit: z.coerce.number().int().min(1).max(2000).optional() }) }),
  asyncHandler(async (req, res) => {
    await sync.hubStampLocal(getPool()); // include the hub's own changes
    const { since, excludeOrigin, limit } = req.validatedQuery;
    res.json({ events: await sync.hubServe(getPool(), since, excludeOrigin, limit) });
  })
);

// Desk: trigger a sync cycle now (also used by tests/manual). Requires a user.
syncRouter.post('/sync/run', requireAuth, asyncHandler(async (_req, res) => res.json(await sync.runSync())));

// UI status chip.
syncRouter.get('/sync/status', requireAuth, asyncHandler(async (_req, res) => res.json(await sync.getStatus())));
