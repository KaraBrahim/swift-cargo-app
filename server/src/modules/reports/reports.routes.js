import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { errors } from '../../lib/AppError.js';
import * as reports from './reports.service.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const period = z.enum(['jour', 'semaine', 'mois', 'trimestre', 'annee']).default('mois');
const currency = z.string().trim().toUpperCase().length(3).default('DZD');

reportsRouter.get(
  '/reports/financial',
  validate({ query: z.object({ period, currency }) }),
  asyncHandler(async (req, res) => res.json(await reports.financialSummary(req.validatedQuery)))
);

reportsRouter.get(
  '/reports/caisse/:id',
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), query: z.object({ period, currency }) }),
  asyncHandler(async (req, res) => {
    const out = await reports.caisseStatement({ caisseId: req.params.id, ...req.validatedQuery });
    if (!out) throw errors.notFound('Caisse introuvable.');
    res.json(out);
  })
);

reportsRouter.get(
  '/reports/person/:type/:id',
  validate({
    params: z.object({ type: z.enum(['personne', 'utilisateur']), id: z.coerce.number().int().positive() }),
    query: z.object({ currency }),
  }),
  asyncHandler(async (req, res) => {
    const out = await reports.personStatement({
      personType: req.params.type, personId: req.params.id, currency: req.validatedQuery.currency,
    });
    if (!out) throw errors.notFound('Personne introuvable.');
    res.json(out);
  })
);

reportsRouter.get(
  '/reports/orders',
  validate({ query: z.object({ period, currency }) }),
  asyncHandler(async (req, res) => res.json(await reports.orderProfitability(req.validatedQuery)))
);

reportsRouter.get(
  '/reports/losses',
  validate({ query: z.object({ period }) }),
  asyncHandler(async (req, res) => res.json(await reports.lossesReport(req.validatedQuery)))
);
