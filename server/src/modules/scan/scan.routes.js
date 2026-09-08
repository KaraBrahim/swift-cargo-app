import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { resolveScan } from './scan.service.js';

export const scanRouter = Router();
scanRouter.use(requireAuth);

// Ce que la douchette a lu -> ce qu'il faut ouvrir, et ce qu'on attend ensuite.
scanRouter.get(
  '/scan',
  validate({ query: z.object({ code: z.string().trim().min(3).max(120) }) }),
  asyncHandler(async (req, res) => res.json(await resolveScan(req.validatedQuery.code)))
);
