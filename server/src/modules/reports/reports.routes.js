import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { errors } from '../../lib/AppError.js';
import * as reports from './reports.service.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

// Une plage de jours civils, pas un préréglage glissant. Absente, le service
// prend le mois en cours jusqu'à aujourd'hui — la validité du jour lui-même
// (le 31 février passe cette regex) est vérifiée dans lib/dates.js.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.');
const range = { from: day.optional(), to: day.optional() };
const currency = z.string().trim().toUpperCase().length(3).default('DZD');

// Un bon porte trois dates. Le rapport dit laquelle il a suivie, plutôt que
// d'en choisir une en silence.
const dateBy = z.enum(['creation', 'arrivee', 'reglement']).default('creation');

reportsRouter.get(
  '/reports/financial',
  validate({ query: z.object({ ...range, currency }) }),
  asyncHandler(async (req, res) => res.json(await reports.financialSummary(req.validatedQuery)))
);

reportsRouter.get(
  '/reports/money',
  validate({ query: z.object({ ...range, currency }) }),
  asyncHandler(async (req, res) => res.json(await reports.moneyReport(req.validatedQuery)))
);

reportsRouter.get(
  '/reports/people',
  validate({ query: z.object({ ...range, currency }) }),
  asyncHandler(async (req, res) => res.json(await reports.peopleReport(req.validatedQuery)))
);

reportsRouter.get(
  '/reports/goods',
  validate({ query: z.object({ ...range, dateBy }) }),
  asyncHandler(async (req, res) => res.json(await reports.goodsReport(req.validatedQuery)))
);

reportsRouter.get(
  '/reports/caisse/:id',
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    query: z.object({ ...range, currency }),
  }),
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
    query: z.object({ ...range, currency }),
  }),
  asyncHandler(async (req, res) => {
    const out = await reports.personStatement({
      personType: req.params.type, personId: req.params.id, ...req.validatedQuery,
    });
    if (!out) throw errors.notFound('Personne introuvable.');
    res.json(out);
  })
);

reportsRouter.get(
  '/reports/orders',
  validate({ query: z.object({ ...range, currency, dateBy }) }),
  asyncHandler(async (req, res) => res.json(await reports.orderProfitability(req.validatedQuery)))
);

reportsRouter.get(
  '/reports/losses',
  validate({ query: z.object({ ...range, dateBy }) }),
  asyncHandler(async (req, res) => res.json(await reports.lossesReport(req.validatedQuery)))
);
