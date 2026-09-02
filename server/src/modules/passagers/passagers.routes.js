import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as svc from './passagers.service.js';
import { getAccount, settleAccount } from '../accounts/accounts.service.js';

export const passagersRouter = Router();
passagersRouter.use(requireAuth);

const id = z.coerce.number().int().positive();

passagersRouter.get(
  '/passagers/:id/account',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ account: await getAccount('passager', req.params.id) }))
);

// We pay the passager what we owe them (cash OUT), any amount, from their profile.
passagersRouter.post(
  '/passagers/:id/payment',
  validate({
    params: z.object({ id }),
    body: z.object({
      caisseId: z.coerce.number().int().positive(),
      amount: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
      currency: z.string().trim().toUpperCase().length(3).default('DZD'),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => res.json(
    await settleAccount({ admin: req.admin, personType: 'passager', personId: req.params.id, ...req.body, ip: req.ip })
  ))
);
const body = z.object({
  type: z.enum(['regular', 'auto']).default('regular'),
  full_name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
});

passagersRouter.get(
  '/passagers',
  validate({ query: z.object({ search: z.string().trim().max(80).optional(), type: z.enum(['regular', 'auto']).optional(), includeInactive: z.coerce.boolean().optional() }) }),
  asyncHandler(async (req, res) => res.json({ passagers: await svc.listPassagers(req.validatedQuery) }))
);

passagersRouter.get(
  '/passagers/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ passager: await svc.getPassager(req.params.id) }))
);

passagersRouter.post(
  '/passagers',
  validate({ body }),
  asyncHandler(async (req, res) => res.status(201).json({ passager: await svc.createPassager({ admin: req.admin, data: req.body, ip: req.ip }) }))
);

passagersRouter.put(
  '/passagers/:id',
  validate({ params: z.object({ id }), body }),
  asyncHandler(async (req, res) => res.json({ passager: await svc.updatePassager({ admin: req.admin, id: req.params.id, data: req.body, ip: req.ip }) }))
);

passagersRouter.post(
  '/passagers/:id/active',
  validate({ params: z.object({ id }), body: z.object({ active: z.boolean() }) }),
  asyncHandler(async (req, res) => res.json({ passager: await svc.setPassagerActive({ admin: req.admin, id: req.params.id, active: req.body.active, ip: req.ip }) }))
);
