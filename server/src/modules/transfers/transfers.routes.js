import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as svc from './transfers.service.js';

export const transfersRouter = Router();
transfersRouter.use(requireAuth);

const id = z.coerce.number().int().positive();
const num = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

transfersRouter.get(
  '/office-transfers',
  validate({ query: z.object({ status: z.enum(['envoye', 'recu']).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }) }),
  asyncHandler(async (req, res) => res.json({ transfers: await svc.listTransfers(req.validatedQuery) }))
);

transfersRouter.post(
  '/office-transfers',
  validate({ body: z.object({
    fromCaisseId: id,
    toOffice: z.enum(['china', 'algeria']),
    currency: z.string().trim().toUpperCase().length(3),
    amount: num,
    note: z.string().trim().max(300).optional(),
  }) }),
  asyncHandler(async (req, res) => res.status(201).json({ transfer: await svc.sendTransfer({ admin: req.admin, ...req.body, ip: req.ip }) }))
);

transfersRouter.post(
  '/office-transfers/:id/receive',
  validate({ params: z.object({ id }), body: z.object({ toCaisseId: id, note: z.string().trim().max(300).optional() }) }),
  asyncHandler(async (req, res) => res.json({ transfer: await svc.receiveTransfer({ admin: req.admin, id: req.params.id, ...req.body, ip: req.ip }) }))
);

// Put a received transfer back in flight (removes the destination's IN leg).
transfersRouter.post(
  '/office-transfers/:id/unreceive',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ transfer: await svc.unreceiveTransfer({ admin: req.admin, id: req.params.id, ip: req.ip }) }))
);

transfersRouter.patch(
  '/office-transfers/:id',
  validate({ params: z.object({ id }), body: z.object({ amount: num.optional(), note: z.string().trim().max(300).optional() }) }),
  asyncHandler(async (req, res) => res.json({ transfer: await svc.updateTransfer({ admin: req.admin, id: req.params.id, ...req.body, ip: req.ip }) }))
);

transfersRouter.delete(
  '/office-transfers/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json(await svc.deleteTransfer({ admin: req.admin, id: req.params.id, ip: req.ip })))
);
