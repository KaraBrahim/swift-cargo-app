import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './agenda.service.js';

export const agendaRouter = Router();

const day = z.string().trim().max(10);

// Qui vient au bureau, quel jour : arrivées promises, départs prévus, retraits
// de fournisseurs. `today` est le jour de la personne qui regarde.
agendaRouter.get(
  '/agenda',
  validate({ query: z.object({ from: day, to: day, today: day.optional() }) }),
  asyncHandler(async (req, res) => res.json(await svc.agenda(req.validatedQuery)))
);

// Le résumé du tableau de bord : aujourd'hui, demain, et les retards.
agendaRouter.get(
  '/agenda/summary',
  validate({ query: z.object({ today: day.optional() }) }),
  asyncHandler(async (req, res) => res.json(await svc.agendaSummary(req.validatedQuery)))
);
