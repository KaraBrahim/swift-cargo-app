import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as svc from './printing.service.js';

export const printingRouter = Router();
printingRouter.use(requireAuth);

const id = z.coerce.number().int().positive();

// Same shape as the `impression` settings key, all optional: the test route
// accepts a partial override so a printer can be tried before it is saved.
const overrides = z.object({
  mode: z.enum(['navigateur', 'reseau', 'windows', 'fichier']).optional(),
  imprimante: z.string().trim().max(200).optional(),
  hote: z.string().trim().max(120).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  largeur: z.coerce.number().int().refine((v) => v === 58 || v === 80, 'Largeur 58 ou 80 mm.').optional(),
  type: z.enum(['epson', 'star', 'tanca', 'daruma', 'brother']).optional(),
  jeu_caracteres: z.string().trim().max(40).optional(),
  copies: z.coerce.number().int().min(1).max(5).optional(),
  couper: z.boolean().optional(),
  tiroir: z.boolean().optional(),
  fichier: z.string().trim().max(300).optional(),
}).partial();

// Configuration + whether the printer answers, for the settings page.
printingRouter.get('/print/status', asyncHandler(async (_req, res) => res.json(await svc.getStatus())));

// Printers installed on this machine, so the name can be picked, not typed.
printingRouter.get('/print/printers', asyncHandler(async (_req, res) => res.json({ printers: await svc.listPrinters() })));

printingRouter.post(
  '/print/test',
  validate({ body: overrides }),
  asyncHandler(async (req, res) => res.json(await svc.printTest({ admin: req.admin, overrides: req.body, ip: req.ip })))
);

printingRouter.post(
  '/print/bon/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json(await svc.printBon({ admin: req.admin, id: req.params.id, ip: req.ip })))
);

printingRouter.post(
  '/print/order/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json(await svc.printOrder({ admin: req.admin, id: req.params.id, ip: req.ip })))
);

printingRouter.post(
  '/print/mouvement/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json(await svc.printMovement({ admin: req.admin, id: req.params.id, ip: req.ip })))
);
