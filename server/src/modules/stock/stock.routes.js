import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as svc from './stock.service.js';

export const stockRouter = Router();
stockRouter.use(requireAuth);

const id = z.coerce.number().int().positive();
const qty = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).optional();
const office = z.enum(['china', 'algeria']);
// An article is just a catalogue entry (name + category) — quantities live per
// office in stock_levels, set via the /level endpoint.
const itemBody = z.object({
  category_id: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
  name: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(1000).optional(),
});

// Categories
stockRouter.get(
  '/stock/categories',
  validate({ query: z.object({ includeInactive: z.coerce.boolean().optional() }) }),
  asyncHandler(async (req, res) => res.json({ categories: await svc.listCategories(req.validatedQuery) }))
);
stockRouter.post(
  '/stock/categories',
  validate({ body: z.object({ name: z.string().trim().min(1).max(80) }) }),
  asyncHandler(async (req, res) => res.status(201).json({ category: await svc.createCategory({ admin: req.admin, name: req.body.name, ip: req.ip }) }))
);
stockRouter.put(
  '/stock/categories/:id',
  validate({ params: z.object({ id }), body: z.object({ name: z.string().trim().min(1).max(80), active: z.boolean().default(true) }) }),
  asyncHandler(async (req, res) => res.json({ category: await svc.updateCategory({ admin: req.admin, id: req.params.id, ...req.body, ip: req.ip }) }))
);
stockRouter.delete(
  '/stock/categories/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json(await svc.deleteCategory({ admin: req.admin, id: req.params.id, ip: req.ip })))
);

// Items
stockRouter.get(
  '/stock/items',
  validate({ query: z.object({ search: z.string().trim().max(80).optional(), categoryId: z.coerce.number().int().positive().optional(), includeInactive: z.coerce.boolean().optional() }) }),
  asyncHandler(async (req, res) => res.json({ items: await svc.listItems(req.validatedQuery) }))
);
stockRouter.post(
  '/stock/items',
  validate({ body: itemBody }),
  asyncHandler(async (req, res) => res.status(201).json({ item: await svc.createItem({ admin: req.admin, data: req.body, ip: req.ip }) }))
);
stockRouter.put(
  '/stock/items/:id',
  validate({ params: z.object({ id }), body: itemBody }),
  asyncHandler(async (req, res) => res.json({ item: await svc.updateItem({ admin: req.admin, id: req.params.id, data: req.body, ip: req.ip }) }))
);
// Full picture of one article: where it is, its movements, the bons using it.
stockRouter.get(
  '/stock/items/:id/detail',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ item: await svc.getItemDetail(req.params.id) }))
);

// Remove a manual stock correction (bon-driven movements are refused).
stockRouter.delete(
  '/stock/movements/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json(await svc.deleteMovement({ admin: req.admin, id: req.params.id, ip: req.ip })))
);

stockRouter.delete(
  '/stock/items/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json(await svc.deleteItem({ admin: req.admin, id: req.params.id, ip: req.ip })))
);
stockRouter.post(
  '/stock/items/:id/active',
  validate({ params: z.object({ id }), body: z.object({ active: z.boolean() }) }),
  asyncHandler(async (req, res) => res.json({ item: await svc.setItemActive({ admin: req.admin, id: req.params.id, active: req.body.active, ip: req.ip }) }))
);

// Per-office levels: the Stock page shows one office at a time.
stockRouter.get(
  '/stock/levels',
  validate({ query: z.object({ office: office.default('china'), search: z.string().trim().max(80).optional(), categoryId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => res.json({ items: await svc.listLevels(req.validatedQuery) }))
);

// En transit : parti de Chine, pas encore arrivé en Algérie.
stockRouter.get(
  '/stock/in-transit',
  validate({ query: z.object({ search: z.string().trim().max(80).optional(), categoryId: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => res.json({ items: await svc.listInTransit(req.validatedQuery) }))
);

// Set an article's absolute level at one office (manual inventory / adjustment).
stockRouter.post(
  '/stock/items/:id/level',
  validate({ params: z.object({ id }), body: z.object({ office, quantity: qty, weight_kg: qty, cbm: qty, note: z.string().trim().max(500).optional() }) }),
  asyncHandler(async (req, res) => res.status(201).json({ level: await svc.setLevel({ admin: req.admin, itemId: req.params.id, ...req.body, ip: req.ip }) }))
);
