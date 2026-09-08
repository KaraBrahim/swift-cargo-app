import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireSuperadmin } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import * as caisse from './caisse.service.js';

export const caisseRouter = Router();
caisseRouter.use(requireAuth);
// Un réessai après un timeout ne doit pas rejouer l'opération : voir
// middleware/idempotent.js. Sans l'en-tête, comportement inchangé.
caisseRouter.use(idempotent);

const id = z.coerce.number().int().positive();
const code = z.string().trim().toUpperCase().length(3);
const amount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d+)?$/.test(v), 'Montant positif attendu.');
const note = z.string().trim().max(500).optional();

caisseRouter.get('/caisses', asyncHandler(async (_req, res) => {
  res.json({ caisses: await caisse.listCaisses() });
}));

caisseRouter.post(
  '/caisses',
  requireSuperadmin,
  validate({ body: z.object({ label: z.string().trim().min(1).max(80), office: z.string().trim().max(40).optional() }) }),
  asyncHandler(async (req, res) => res.status(201).json({ caisse: await caisse.createCaisse({ admin: req.admin, ...req.body, ip: req.ip }) }))
);

caisseRouter.put(
  '/caisses/:id',
  requireSuperadmin,
  validate({ params: z.object({ id }), body: z.object({ label: z.string().trim().min(1).max(80) }) }),
  asyncHandler(async (req, res) => res.json({ caisse: await caisse.updateCaisse({ admin: req.admin, id: req.params.id, label: req.body.label, ip: req.ip }) }))
);

caisseRouter.post(
  '/caisses/:id/active',
  requireSuperadmin,
  validate({ params: z.object({ id }), body: z.object({ active: z.boolean() }) }),
  asyncHandler(async (req, res) => res.json({ caisse: await caisse.setCaisseActive({ admin: req.admin, id: req.params.id, active: req.body.active, ip: req.ip }) }))
);

caisseRouter.get(
  '/caisses/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ caisse: await caisse.getCaisseDetail(req.params.id) }))
);

caisseRouter.get(
  '/caisses/:id/ledger',
  validate({
    params: z.object({ id }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), currency: code.optional(), adminId: z.coerce.number().int().positive().optional() }),
  }),
  asyncHandler(async (req, res) => {
    // The actor list comes back with every page: it is computed over the whole
    // caisse, so filtering to one admin must not shrink the tabs.
    const [transactions, { actors, total }] = await Promise.all([
      caisse.ledger(req.params.id, req.validatedQuery),
      caisse.ledgerActors(req.params.id),
    ]);
    res.json({ transactions, actors, total });
  })
);

// Correct or remove a hand-entered movement. Anything produced by a bon, a
// conversion or a transfer is refused by the service with a pointer to its source.
caisseRouter.patch(
  '/caisses/movements/:id',
  validate({ params: z.object({ id }), body: z.object({ amount: z.union([z.string(), z.number()]).transform((v) => String(v).trim()).optional(), note: z.string().trim().max(300).optional() }) }),
  asyncHandler(async (req, res) => res.json({ transaction: await caisse.updateMovement({ admin: req.admin, id: req.params.id, ...req.body, ip: req.ip }) }))
);

caisseRouter.delete(
  '/caisses/movements/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json(await caisse.deleteMovement({ admin: req.admin, id: req.params.id, ip: req.ip })))
);

caisseRouter.get(
  '/caisses/:id/conversions',
  validate({ params: z.object({ id }), query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }) }),
  asyncHandler(async (req, res) =>
    res.json({ conversions: await caisse.listConversions(req.params.id, req.validatedQuery) })
  )
);

caisseRouter.post(
  '/caisses/:id/deposit',
  validate({ params: z.object({ id }), body: z.object({ currency: code, amount, note }) }),
  asyncHandler(async (req, res) =>
    res.status(201).json(await caisse.deposit({ admin: req.admin, caisseId: req.params.id, ip: req.ip, ...req.body }))
  )
);

caisseRouter.post(
  '/caisses/:id/withdraw',
  validate({ params: z.object({ id }), body: z.object({ currency: code, amount, note }) }),
  asyncHandler(async (req, res) =>
    res.status(201).json(await caisse.withdraw({ admin: req.admin, caisseId: req.params.id, ip: req.ip, ...req.body }))
  )
);

caisseRouter.post(
  '/caisses/:id/convert',
  validate({
    params: z.object({ id }),
    body: z.object({ fromCurrency: code, toCurrency: code, amount, note }),
  }),
  asyncHandler(async (req, res) =>
    res.status(201).json(await caisse.convertCurrency({ admin: req.admin, caisseId: req.params.id, ip: req.ip, ...req.body }))
  )
);

// POST /transfer is gone: a caisse-to-caisse transfer is now the same thing as
// an office transfer, and goes through POST /office-transfers so that it waits
// for the destination to confirm before any money moves.
