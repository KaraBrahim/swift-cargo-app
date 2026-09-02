import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as svc from './fournisseurs.service.js';
import { getAccount, settleAccount } from '../accounts/accounts.service.js';

export const fournisseursRouter = Router();
fournisseursRouter.use(requireAuth);

const id = z.coerce.number().int().positive();

fournisseursRouter.get(
  '/fournisseurs/:id/account',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ account: await getAccount('fournisseur', req.params.id) }))
);

// The fournisseur pays down their debt (cash IN), any amount, from their profile.
fournisseursRouter.post(
  '/fournisseurs/:id/payment',
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
    await settleAccount({ admin: req.admin, personType: 'fournisseur', personId: req.params.id, ...req.body, ip: req.ip })
  ))
);
const body = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).optional(),
  city: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(1000).optional(),
});

fournisseursRouter.get(
  '/fournisseurs',
  validate({ query: z.object({ search: z.string().trim().max(80).optional(), includeInactive: z.coerce.boolean().optional() }) }),
  asyncHandler(async (req, res) => res.json({ fournisseurs: await svc.listFournisseurs(req.validatedQuery) }))
);

fournisseursRouter.get(
  '/fournisseurs/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ fournisseur: await svc.getFournisseur(req.params.id) }))
);

fournisseursRouter.post(
  '/fournisseurs',
  validate({ body }),
  asyncHandler(async (req, res) => res.status(201).json({ fournisseur: await svc.createFournisseur({ admin: req.admin, data: req.body, ip: req.ip }) }))
);

fournisseursRouter.put(
  '/fournisseurs/:id',
  validate({ params: z.object({ id }), body }),
  asyncHandler(async (req, res) => res.json({ fournisseur: await svc.updateFournisseur({ admin: req.admin, id: req.params.id, data: req.body, ip: req.ip }) }))
);

fournisseursRouter.post(
  '/fournisseurs/:id/active',
  validate({ params: z.object({ id }), body: z.object({ active: z.boolean() }) }),
  asyncHandler(async (req, res) => res.json({ fournisseur: await svc.setFournisseurActive({ admin: req.admin, id: req.params.id, active: req.body.active, ip: req.ip }) }))
);
