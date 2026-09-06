import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  getSummary, listDebts, listPayments, updatePayment, deletePayment,
  createPersonTransaction, listCharges, createCharge, updateCharge, deleteCharge,
} from './accounts.service.js';

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

accountsRouter.get('/accounts/summary', asyncHandler(async (_req, res) => res.json(await getSummary())));

// Open obligations, split by direction (we owe / they owe).
accountsRouter.get('/accounts/debts', asyncHandler(async (_req, res) => res.json(await listDebts())));

// Everything already settled in cash, both directions.
accountsRouter.get(
  '/accounts/payments',
  validate({ query: z.object({
    personType: z.enum(['personne', 'utilisateur']).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  }) }),
  asyncHandler(async (req, res) => res.json(await listPayments(req.validatedQuery)))
);

// One payment, editable and removable from anywhere it is listed (a bon, a
// person's profile, the caisse). Caisse movement and ledger entry move together.
const entryId = z.coerce.number().int().positive();

accountsRouter.patch(
  '/payments/:entryId',
  validate({
    params: z.object({ entryId }),
    body: z.object({
      amount: z.union([z.string(), z.number()]).transform((v) => String(v).trim()).optional(),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => res.json({ payment: await updatePayment({ admin: req.admin, entryId: req.params.entryId, ...req.body, ip: req.ip }) }))
);

accountsRouter.delete(
  '/payments/:entryId',
  validate({ params: z.object({ entryId }) }),
  asyncHandler(async (req, res) => res.json(await deletePayment({ admin: req.admin, entryId: req.params.entryId, ip: req.ip })))
);

const money = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

// Free-form entry on anyone's account: a personne (fournisseur, passager, or
// both) or an utilisateur.
accountsRouter.post(
  '/person-transactions',
  validate({ body: z.object({
    personType: z.enum(['personne', 'utilisateur']),
    personId: z.coerce.number().int().positive(),
    direction: z.enum(['in', 'out']),
    amount: money,
    currency: z.string().trim().toUpperCase().length(3).default('DZD'),
    type: z.enum(['avance', 'remboursement', 'salaire', 'prime', 'adjustment', 'autre']).default('autre'),
    caisseId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
    note: z.string().trim().max(300).optional(),
  }) }),
  asyncHandler(async (req, res) => res.status(201).json(await createPersonTransaction({ admin: req.admin, ...req.body, ip: req.ip })))
);

// Running costs of the business itself.
const CATEGORY = z.enum(['internet', 'electricite', 'eau', 'loyer', 'salaire', 'transport', 'fourniture', 'taxe', 'entretien', 'autre']);

accountsRouter.get(
  '/charges',
  validate({ query: z.object({ category: CATEGORY.optional(), period: z.string().trim().max(7).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }) }),
  asyncHandler(async (req, res) => res.json(await listCharges(req.validatedQuery)))
);

accountsRouter.post(
  '/charges',
  validate({ body: z.object({
    category: CATEGORY,
    label: z.string().trim().min(1).max(160),
    amount: money,
    currency: z.string().trim().toUpperCase().length(3).default('DZD'),
    caisseId: z.coerce.number().int().positive(),
    period: z.string().trim().regex(/^\d{4}-\d{2}$/, 'Format attendu AAAA-MM').optional(),
    recurring: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  }) }),
  asyncHandler(async (req, res) => res.status(201).json({ charge: await createCharge({ admin: req.admin, ...req.body, ip: req.ip }) }))
);

accountsRouter.patch(
  '/charges/:id',
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({
    category: CATEGORY.optional(),
    label: z.string().trim().min(1).max(160).optional(),
    amount: money.optional(),
    period: z.string().trim().regex(/^\d{4}-\d{2}$/).optional(),
    recurring: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  }) }),
  asyncHandler(async (req, res) => res.json({ charge: await updateCharge({ admin: req.admin, id: req.params.id, ...req.body, ip: req.ip }) }))
);

accountsRouter.delete(
  '/charges/:id',
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => res.json(await deleteCharge({ admin: req.admin, id: req.params.id, ip: req.ip })))
);
