import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireSuperadmin } from '../../middleware/auth.js';
import * as svc from './maintenance.service.js';

export const maintenanceRouter = Router();

// Tout ici est réservé au super-admin.
const confirm = z.string().trim();

maintenanceRouter.get('/maintenance/overview', requireSuperadmin, asyncHandler(async (_req, res) => res.json(await svc.overview())));

maintenanceRouter.get('/maintenance/backup', requireSuperadmin, asyncHandler(async (_req, res) => {
  const data = await svc.backup();
  res.setHeader('content-disposition', `attachment; filename="swift-cargo-${data.exported_at.slice(0, 10)}.json"`);
  res.json(data);
}));

maintenanceRouter.post(
  '/maintenance/purge',
  requireSuperadmin,
  validate({ body: z.object({ domains: z.array(z.enum(svc.DOMAINS.map((d) => d.key))).min(1), confirm }) }),
  asyncHandler(async (req, res) => res.json(await svc.purge({ admin: req.admin, ...req.body, ip: req.ip })))
);

maintenanceRouter.post(
  '/maintenance/reset',
  requireSuperadmin,
  validate({ body: z.object({ confirm }) }),
  asyncHandler(async (req, res) => res.json(await svc.reset({ admin: req.admin, ...req.body, ip: req.ip })))
);

maintenanceRouter.post('/maintenance/recompute', requireSuperadmin, asyncHandler(async (req, res) => res.json(await svc.recompute({ admin: req.admin, ip: req.ip }))));
maintenanceRouter.post('/maintenance/revoke-sessions', requireSuperadmin, asyncHandler(async (req, res) => res.json(await svc.revokeSessions({ admin: req.admin, ip: req.ip }))));
