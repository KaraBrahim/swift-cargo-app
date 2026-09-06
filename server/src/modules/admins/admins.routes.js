import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireSuperadmin } from '../../middleware/auth.js';
import * as admins from './admins.service.js';
import { isSuperadmin } from '../../lib/visibility.js';

export const adminsRouter = Router();
adminsRouter.use(requireAuth);

const office = z.enum(['china', 'algeria']).nullish();
const password = z.string().min(8, 'Au moins 8 caractères.').max(128);

const profileBody = {
  full_name: z.string().trim().min(2).max(120),
  office,
  email: z.string().trim().email('Adresse e-mail invalide.').max(160).nullish().or(z.literal('')),
  phone: z.string().trim().max(40).nullish().or(z.literal('')),
};

adminsRouter.get(
  '/admins',
  validate({ query: z.object({ includeInactive: z.coerce.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    res.json({
      admins: await admins.listAdmins({ ...req.validatedQuery, viewerIsSuperadmin: isSuperadmin(req.admin) }),
    });
  })
);

adminsRouter.post(
  '/admins',
  requireSuperadmin,
  validate({
    body: z.object({
      username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Lettres, chiffres, . _ - uniquement.'),
      password,
      ...profileBody,
    }),
  }),
  asyncHandler(async (req, res) => {
    const admin = await admins.createAdmin({ admin: req.admin, data: req.body, ip: req.ip });
    res.status(201).json({ admin });
  })
);

adminsRouter.patch(
  '/admins/:id',
  requireSuperadmin,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object(profileBody) }),
  asyncHandler(async (req, res) => {
    const admin = await admins.updateAdmin({ admin: req.admin, id: req.params.id, data: req.body, ip: req.ip });
    res.json({ admin });
  })
);

adminsRouter.post(
  '/admins/:id/active',
  requireSuperadmin,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ active: z.boolean() }) }),
  asyncHandler(async (req, res) => {
    const admin = await admins.setAdminActive({ admin: req.admin, id: req.params.id, active: req.body.active, ip: req.ip });
    res.json({ admin });
  })
);

adminsRouter.post(
  '/admins/:id/password',
  requireSuperadmin,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ newPassword: password }) }),
  asyncHandler(async (req, res) => {
    res.json(await admins.resetPassword({ admin: req.admin, id: req.params.id, newPassword: req.body.newPassword, ip: req.ip }));
  })
);
