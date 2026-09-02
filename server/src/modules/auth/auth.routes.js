import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as auth from './auth.service.js';
import { config } from '../../config.js';

export const authRouter = Router();

const loginSchema = {
  body: z.object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(200),
    // « Rester connecté ». Asks for a longer session — it does not, and must
    // not, cause any password to be stored.
    remember: z.boolean().optional(),
  }),
};

authRouter.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await auth.login({ ...req.body, ip: req.ip });
    res.cookie('sc_token', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      // Was hardcoded to 12h regardless of SESSION_TTL_HOURS, so the cookie and
      // the server-side session could disagree about when they expire.
      maxAge: result.maxAgeMs,
    });
    res.json(result);
  })
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await auth.logout({ token: req.token, admin: req.admin, ip: req.ip });
    res.clearCookie('sc_token', { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure });
    res.json({ ok: true });
  })
);

authRouter.get('/me', requireAuth, (req, res) => res.json({ admin: req.admin }));

const changePwSchema = {
  body: z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8, 'Au moins 8 caractères.').max(200),
  }),
};

authRouter.post(
  '/change-password',
  requireAuth,
  validate(changePwSchema),
  asyncHandler(async (req, res) => {
    await auth.changePassword({ admin: req.admin, ...req.body, ip: req.ip });
    res.json({ ok: true });
  })
);
