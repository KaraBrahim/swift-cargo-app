import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireSuperadmin } from '../../middleware/auth.js';
import * as svc from './remises.service.js';

export const remisesRouter = Router();

const id = z.coerce.number().int().positive();
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ');
const label = z.string().trim().min(1).max(80);

// La liste des motifs : tout le monde la lit (elle alimente le choix au comptoir),
// seul le super-administrateur la modifie.
remisesRouter.get(
  '/remises/reasons',
  validate({ query: z.object({ includeInactive: z.coerce.boolean().optional() }) }),
  asyncHandler(async (req, res) => res.json({ reasons: await svc.listReasons(req.validatedQuery) }))
);

remisesRouter.post(
  '/remises/reasons',
  requireSuperadmin,
  validate({ body: z.object({ label }) }),
  asyncHandler(async (req, res) => res.status(201).json({ reason: await svc.createReason({ admin: req.admin, label: req.body.label, ip: req.ip }) }))
);

remisesRouter.patch(
  '/remises/reasons/:id',
  requireSuperadmin,
  validate({ params: z.object({ id }), body: z.object({ label: label.optional(), active: z.boolean().optional() }) }),
  asyncHandler(async (req, res) => res.json({ reason: await svc.updateReason({ admin: req.admin, id: req.params.id, ...req.body, ip: req.ip }) }))
);

// Le rapport : toutes les remises d'une période, avec leurs totaux.
remisesRouter.get(
  '/remises',
  validate({
    query: z.object({
      from: day, to: day,
      personId: id.optional(), adminId: id.optional(),
      // 0 = « sans motif »
      reasonId: z.coerce.number().int().min(0).optional(),
      kind: z.enum(['amount', 'percent', 'round', 'settle']).optional(),
      direction: z.enum(['accordee', 'obtenue']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => res.json(await svc.report(req.validatedQuery)))
);
