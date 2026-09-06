import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as notif from './notifications.service.js';
import { isSuperadmin } from '../../lib/visibility.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/notifications',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }) }),
  asyncHandler(async (req, res) => res.json(await notif.listNotifications(req.admin.id, { ...req.validatedQuery, isSuper: isSuperadmin(req.admin) })))
);

notificationsRouter.get(
  '/notifications/count',
  asyncHandler(async (req, res) => res.json({ unread: await notif.unreadCount(req.admin.id, isSuperadmin(req.admin)) }))
);

notificationsRouter.post(
  '/notifications/seen',
  asyncHandler(async (req, res) => res.json(await notif.markSeen(req.admin.id, isSuperadmin(req.admin))))
);
