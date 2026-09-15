import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import * as dash from './dashboard.service.js';
import { isSuperadmin } from '../../lib/visibility.js';

export const dashboardRouter = Router();

const periodQuery = z.object({
  period: z.enum(['jour', 'semaine', 'mois', 'trimestre', 'annee']).default('mois'),
  currency: z.string().trim().toUpperCase().length(3).default('DZD'),
});

// Everything the tableau de bord needs, in one round trip.
dashboardRouter.get(
  '/dashboard/overview',
  validate({ query: periodQuery }),
  asyncHandler(async (req, res) => {
    const { period, currency } = req.validatedQuery;
    res.json(await dash.overview({ period, currency, isSuper: isSuperadmin(req.admin) }));
  })
);

// Just the financial panel — re-fetched when the period selector changes.
dashboardRouter.get(
  '/dashboard/financial',
  validate({ query: periodQuery }),
  asyncHandler(async (req, res) => {
    const { period, currency } = req.validatedQuery;
    res.json(await dash.financial(period, currency));
  })
);

// Chiffre d'affaires in both measures (argent + quantité).
dashboardRouter.get(
  '/dashboard/revenue',
  validate({ query: periodQuery }),
  asyncHandler(async (req, res) => {
    const { period, currency } = req.validatedQuery;
    res.json(await dash.revenue(period, currency));
  })
);

// A single stat tile at its own period — the per-card 3-dots picker.
dashboardRouter.get(
  '/dashboard/tile/:key',
  validate({
    params: z.object({ key: z.enum(['bons', 'revenue', 'passagers', 'stock']) }),
    query: periodQuery,
  }),
  asyncHandler(async (req, res) => {
    const { period, currency } = req.validatedQuery;
    res.json(await dash.tile(req.params.key, period, currency));
  })
);

dashboardRouter.get('/dashboard/pipeline', asyncHandler(async (_req, res) => res.json(await dash.pipeline())));
