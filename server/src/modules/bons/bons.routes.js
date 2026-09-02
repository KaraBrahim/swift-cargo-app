import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as svc from './bons.service.js';

export const bonsRouter = Router();
bonsRouter.use(requireAuth);

const id = z.coerce.number().int().positive();
const num = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const status = z.enum(['cree', 'en_transit', 'arrive', 'regle']);

// A line names an article (typed designation OR a reused itemId) and is
// quantified by exactly one measure (value + measure). quantity/weight_kg/cbm
// are still accepted for backward compatibility.
const lineSchema = z.object({
  designation: z.string().trim().max(200).optional(),
  itemId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
  createItem: z.boolean().optional(),
  categoryId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
  measure: z.enum(['quantite', 'poids', 'cbm']).optional(),
  value: num.optional(),
  quantity: num.optional(),
  unit: z.string().trim().max(20).optional(),
  weight_kg: num.optional(),
  cbm: num.optional(),
  unitPrice: num.optional(),
  // A bon passager line draws from this bon fournisseur line.
  sourceLineId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
  note: z.string().trim().max(300).optional(),
});

const createSchema = z.object({
  fournisseurId: z.coerce.number().int().positive(),
  passagerId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
  transportCurrency: z.string().trim().toUpperCase().length(3).default('DZD'),
  transportFee: num.optional(),
  discount: num.optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(lineSchema).min(1),
});

// Editing a bon (only while « Créé »): replace lines, fee/currency, passager.
const updateSchema = z.object({
  passagerId: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().int().positive().nullable()).optional(),
  transportCurrency: z.string().trim().toUpperCase().length(3).optional(),
  transportFee: num.optional(),
  discount: num.optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(lineSchema).min(1),
});

bonsRouter.get(
  '/bons',
  validate({ query: z.object({ status: status.optional(), search: z.string().trim().max(80).optional(), fournisseurId: z.coerce.number().int().positive().optional(), passagerId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }) }),
  asyncHandler(async (req, res) => res.json({ bons: await svc.listBons(req.validatedQuery) }))
);

// Goods still waiting in a bon fournisseur for a passager to carry them.
// Declared before '/bons/:id' so "allocatable" is not read as an id.
bonsRouter.get(
  '/bons/allocatable',
  validate({ query: z.object({ fournisseurId: z.coerce.number().int().positive().optional(), orderId: z.coerce.number().int().positive().optional(), forBonId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => res.json({ lines: await svc.listAllocatable(req.validatedQuery) }))
);

bonsRouter.get(
  '/bons/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ bon: await svc.getBonDetail(req.params.id) }))
);

bonsRouter.post(
  '/bons',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => res.status(201).json({ bon: await svc.createBon({ admin: req.admin, data: req.body, ip: req.ip }) }))
);

bonsRouter.patch(
  '/bons/:id',
  validate({ params: z.object({ id }), body: updateSchema }),
  asyncHandler(async (req, res) => res.json({ bon: await svc.updateBon({ admin: req.admin, id: req.params.id, data: req.body, ip: req.ip }) }))
);

// Undo an encaissement/paiement: removes the caisse movement and the person's
// ledger entry together, so neither side is left dangling.
bonsRouter.delete(
  '/bons/:id/payments/:entryId',
  validate({ params: z.object({ id, entryId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => res.json({
    bon: await svc.cancelBonPayment({ admin: req.admin, id: req.params.id, entryId: req.params.entryId, ip: req.ip }),
  }))
);

bonsRouter.delete(
  '/bons/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json(await svc.deleteBon({ admin: req.admin, id: req.params.id, ip: req.ip })))
);

bonsRouter.post(
  '/bons/:id/advance',
  validate({ params: z.object({ id }), body: z.object({ note: z.string().trim().max(300).optional() }) }),
  asyncHandler(async (req, res) => res.json({ bon: await svc.advanceStatus({ admin: req.admin, id: req.params.id, note: req.body.note, ip: req.ip }) }))
);

// Jump a bon to any lifecycle stage (clickable stepper); backward reverses stock
// and money.
bonsRouter.post(
  '/bons/:id/status',
  validate({ params: z.object({ id }), body: z.object({ target: z.enum(['cree', 'en_transit', 'arrive', 'regle']), note: z.string().trim().max(300).optional() }) }),
  asyncHandler(async (req, res) => res.json({ bon: await svc.setBonStatus({ admin: req.admin, id: req.params.id, target: req.body.target, note: req.body.note, ip: req.ip }) }))
);

bonsRouter.post(
  '/bons/:id/reconcile',
  validate({
    params: z.object({ id }),
    body: z.object({
      lines: z.array(z.object({
        lineId: z.coerce.number().int().positive(),
        missing: num.optional(),
        receivedQuantity: num.optional(),
        responsible: z.string().trim().max(80).optional(),
      })).min(1),
    }),
  }),
  asyncHandler(async (req, res) => res.json({ bon: await svc.reconcile({ admin: req.admin, id: req.params.id, lines: req.body.lines, ip: req.ip }) }))
);

bonsRouter.post(
  '/bons/:id/settle',
  validate({ params: z.object({ id }), body: z.object({ passagerPayment: num.optional(), note: z.string().trim().max(300).optional() }) }),
  asyncHandler(async (req, res) => res.json({ bon: await svc.settle({ admin: req.admin, id: req.params.id, passagerPayment: req.body.passagerPayment, note: req.body.note, ip: req.ip }) }))
);

const moneyAction = {
  params: z.object({ id }),
  body: z.object({ caisseId: z.coerce.number().int().positive(), amount: num.optional(), note: z.string().trim().max(300).optional() }),
};

bonsRouter.post(
  '/bons/:id/collect-fee',
  validate(moneyAction),
  asyncHandler(async (req, res) => res.json({ bon: await svc.collectFee({ admin: req.admin, id: req.params.id, ...req.body, ip: req.ip }) }))
);

bonsRouter.post(
  '/bons/:id/pay-passager',
  validate(moneyAction),
  asyncHandler(async (req, res) => res.json({ bon: await svc.payPassager({ admin: req.admin, id: req.params.id, ...req.body, ip: req.ip }) }))
);
