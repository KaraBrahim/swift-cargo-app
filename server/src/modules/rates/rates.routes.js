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
    .refine((v) => (v.split('.')[1]?.length ?? 0) <= max, `Maximum ${max} décimales.`);

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

ratesRouter.get(
  '/rates/:code/history',
  validate({ params: z.object({ code: z.string().trim().toUpperCase().length(3) }) }),
  asyncHandler(async (req, res) => {
    res.json({ history: await rates.rateHistory(req.params.code) });
  })
);
