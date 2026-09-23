import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotent.js';
import * as svc from './employees.service.js';

export const employeesRouter = Router();

const id = z.coerce.number().int().positive();
const money = z.union([z.string().trim(), z.number()]).transform(String);

employeesRouter.get(
  '/employees',
  validate({ query: z.object({ includeInactive: z.coerce.boolean().optional(), period: z.string().trim().regex(/^\d{4}-\d{2}$/).optional() }) }),
  asyncHandler(async (req, res) => res.json(await svc.listEmployees(req.validatedQuery)))
);

employeesRouter.post(
  '/employees',
  validate({ body: z.object({
    name: z.string().trim().min(1).max(120), poste: z.string().trim().max(120).optional(),
    salary: money, currency: z.string().trim().toUpperCase().length(3).default('DZD'),
    caisseId: id.optional(), note: z.string().trim().max(300).optional(),
  }) }),
  asyncHandler(async (req, res) => res.status(201).json({ employee: await svc.createEmployee({ admin: req.admin, ...req.body, ip: req.ip }) }))
);

employeesRouter.patch(
  '/employees/:id',
  validate({ params: z.object({ id }), body: z.object({
    name: z.string().trim().min(1).max(120).optional(), poste: z.string().trim().max(120).nullable().optional(),
    salary: money.optional(), currency: z.string().trim().toUpperCase().length(3).optional(),
    caisseId: id.nullable().optional(), active: z.boolean().optional(), note: z.string().trim().max(300).nullable().optional(),
  }) }),
  asyncHandler(async (req, res) => res.json({ employee: await svc.updateEmployee({ admin: req.admin, id: req.params.id, ...req.body, ip: req.ip }) }))
);

employeesRouter.get(
  '/employees/:id/payments',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ payments: await svc.listPayments(req.params.id) }))
);

employeesRouter.post(
  '/employees/:id/pay',
  idempotent,
  validate({ params: z.object({ id }), body: z.object({
    amount: money, caisseId: id.optional(),
    period: z.string().trim().regex(/^\d{4}-\d{2}$/).optional(),
    note: z.string().trim().max(300).optional(),
  }) }),
  asyncHandler(async (req, res) => res.status(201).json({ payment: await svc.payEmployee({ admin: req.admin, id: req.params.id, ...req.body, ip: req.ip }) }))
);
