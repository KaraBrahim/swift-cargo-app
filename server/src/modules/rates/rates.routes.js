import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as rates from './rates.service.js';

export const ratesRouter = Router();
ratesRouter.use(requireAuth);

// Decimal-string amount/rate validators (never floats over the wire).
const decimalString = (max = 8) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d+(\.\d+)?$/.test(v), 'Nombre positif attendu.')
    .refine((v) => (v.split('.')[1]?.length ?? 0) <= max, `Maximum ${max} décimales.`)
    // Les taux sont stockés en NUMERIC(24,8) : seize chiffres avant la virgule.
    // Sans ce plafond, un nombre absurde traversait Zod et ressortait en erreur
    // Postgres brute — un 500 là où l'utilisateur mérite « valeur trop élevée ».
    .refine((v) => v.split('.')[0].replace(/^0+/, '').length <= 16, 'Valeur trop élevée.');

// GET /api/currencies  -> currencies with their current black-market rate
ratesRouter.get('/currencies', asyncHandler(async (_req, res) => {
  res.json({ currencies: await rates.listCurrencies() });
}));

const setRateSchema = {
  body: z.object({
    currencyCode: z.string().trim().toUpperCase().length(3),
    dzdPerUnit: decimalString(8).refine((v) => Number(v) > 0, 'Doit être > 0.'),
    note: z.string().trim().max(300).optional(),
  }),
};

// POST /api/rates  -> set a new black-market rate for a currency
ratesRouter.post('/rates', validate(setRateSchema), asyncHandler(async (req, res) => {
  const row = await rates.setRate({ admin: req.admin, ...req.body, ip: req.ip });
  res.status(201).json({ rate: row });
}));

const code = z.string().trim().toUpperCase().length(3);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.');

// ── Pairs ────────────────────────────────────────────────────────────
ratesRouter.get('/pairs', asyncHandler(async (_req, res) => {
  res.json({ pairs: await rates.listPairs() });
}));

ratesRouter.post(
  '/pairs',
  validate({ body: z.object({ fromCode: code, toCode: code }) }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ pair: await rates.addPair({ admin: req.admin, ...req.body, ip: req.ip }) });
  })
);

ratesRouter.post(
  '/pairs/:from/:to/rate',
  validate({
    params: z.object({ from: code, to: code }),
    body: z.object({
      unitsPerUnit: decimalString(8).refine((v) => Number(v) > 0, 'Doit être > 0.'),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const rate = await rates.setPairRate({
      admin: req.admin, fromCode: req.params.from, toCode: req.params.to, ...req.body, ip: req.ip,
    });
    res.status(201).json({ rate });
  })
);

// Back to the computed value.
ratesRouter.post(
  '/pairs/:from/:to/reset',
  validate({ params: z.object({ from: code, to: code }) }),
  asyncHandler(async (req, res) => {
    res.json({ pair: await rates.resetPair({ admin: req.admin, fromCode: req.params.from, toCode: req.params.to, ip: req.ip }) });
  })
);

ratesRouter.delete(
  '/pairs/:from/:to',
  validate({ params: z.object({ from: code, to: code }) }),
  asyncHandler(async (req, res) => {
    res.json(await rates.deletePair({ admin: req.admin, fromCode: req.params.from, toCode: req.params.to, ip: req.ip }));
  })
);

// ── What a pair was worth on a date, or on average over a period ─────
ratesRouter.get(
  '/rates/lookup',
  validate({
    query: z
      .object({ from: code, to: code, date: isoDate.optional(), start: isoDate.optional(), end: isoDate.optional() })
      .refine((q) => Boolean(q.date) !== Boolean(q.start && q.end), 'Indiquez une date, ou un début et une fin.'),
  }),
  asyncHandler(async (req, res) => {
    res.json(await rates.lookup(req.validatedQuery));
  })
);

ratesRouter.get(
  '/rates/:code/history',
  validate({ params: z.object({ code: z.string().trim().toUpperCase().length(3) }) }),
  asyncHandler(async (req, res) => {
    res.json({ history: await rates.rateHistory(req.params.code) });
  })
);
