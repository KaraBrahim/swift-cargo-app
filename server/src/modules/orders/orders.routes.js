import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireSuperadmin } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import * as svc from './orders.service.js';

export const ordersRouter = Router();
// Un réessai après un timeout ne doit pas rejouer l'opération : voir
// middleware/idempotent.js. Sans l'en-tête, comportement inchangé.

const id = z.coerce.number().int().positive();
const num = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const status = z.enum(['ouverte', 'en_transit', 'arrivee', 'livree', 'cloturee']);

const bonSchema = z.object({
  passagerId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
  transportCurrency: z.string().trim().toUpperCase().length(3).default('DZD'),
  transportFee: num.optional(),
  // La marge du bon fournisseur, saisie a la main une fois les details connus.
  commission: num.optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(z.object({
    // A line names an article (typed designation OR a reused itemId) and is
    // quantified by exactly one measure (value + measure). quantity/weight_kg/cbm
    // are still accepted for backward compatibility.
    designation: z.string().trim().max(200).optional(),
    itemId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
    createItem: z.boolean().optional(),
    categoryId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
    measure: z.enum(['quantite', 'poids', 'cbm']).optional(),
    value: num.optional(),
    missingUnitPrice: num.optional(),
    quantity: num.optional(),
    unit: z.string().trim().max(20).optional(),
    weight_kg: num.optional(),
    cbm: num.optional(),
    unitPrice: num.optional(),
    sourceLineId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
    note: z.string().trim().max(300).optional(),
  })).min(1),
});

const createSchema = z.object({
  fournisseurId: z.coerce.number().int().positive(),
  notes: z.string().trim().max(1000).optional(),
  bons: z.array(bonSchema).min(1),
});

ordersRouter.get(
  '/orders',
  validate({ query: z.object({ status: status.optional(), search: z.string().trim().max(80).optional(), fournisseurId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }) }),
  asyncHandler(async (req, res) => res.json({ orders: await svc.listOrders(req.validatedQuery) }))
);

ordersRouter.get(
  '/orders/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ order: await svc.getOrderDetail(req.params.id) }))
);

ordersRouter.post(
  '/orders',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => res.status(201).json({ order: await svc.createOrder({ admin: req.admin, data: req.body, ip: req.ip }) }))
);

ordersRouter.delete(
  '/orders/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json(await svc.deleteOrder({ admin: req.admin, id: req.params.id, ip: req.ip })))
);

// Remettre au fournisseur ce qui est arrivé — tout, ou une partie.
//
// Il n'y a plus de POST /orders/:id/status : le statut d'un ordre est DÉRIVÉ de
// cinq portes (affectation, voyage, arrivée, livraison, paiement), et une route
// qui l'écrivait se faisait écraser par recomputeOrderStatus une ligne plus loin.
// Le stepper de l'écran est redevenu un indicateur.
ordersRouter.post(
  '/orders/:id/deliver',
  validate({
    params: z.object({ id }),
    body: z.object({
      lines: z.array(z.object({
        lineId: z.coerce.number().int().positive(),
        quantity: num,
      })).min(1),
    }),
  }),
  asyncHandler(async (req, res) => res.json({
    order: await svc.deliverOrder({ admin: req.admin, id: req.params.id, lines: req.body.lines, ip: req.ip }),
  }))
);

ordersRouter.post(
  '/orders/:id/deliver/cancel',
  requireSuperadmin,
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({
    order: await svc.cancelDelivery({ admin: req.admin, id: req.params.id, ip: req.ip }),
  }))
);
