// App settings over the app_settings key/value table. Two keys today:
//   societe     — company identity stamped onto printed documents
//   impression  — the thermal printer this desk prints to directly
// The theme is deliberately NOT here: it is a per-machine preference (a desk in
// Algérie may want the light theme while Chine keeps the dark one), so it lives in
// the browser's localStorage, not in shared server state.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { getPool, withTx } from '../../db/pool.js';
import { writeAudit } from '../../lib/audit.js';
import { errors } from '../../lib/AppError.js';
import { PRINT_DEFAULTS } from '../printing/printing.service.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

// Each key declares its own shape and defaults, so an unknown key is rejected
// rather than silently stored.
const SCHEMAS = {
  societe: {
    schema: z.object({
      nom: z.string().trim().max(120),
      adresse: z.string().trim().max(240),
      telephone: z.string().trim().max(60),
      pied_de_page: z.string().trim().max(240),
    }),
    defaults: {
      nom: 'Swift Cargo',
      adresse: '',
      telephone: '',
      pied_de_page: 'Document généré par Swift Cargo',
    },
  },
  // Unlike the theme, this IS shared server state — but each desk runs its own
  // server, so "shared" already means "this desk and its printer".
  impression: {
    schema: z.object({
      mode: z.enum(['navigateur', 'reseau', 'windows', 'fichier']),
      imprimante: z.string().trim().max(200),
      hote: z.string().trim().max(120),
      port: z.coerce.number().int().min(1).max(65535),
      largeur: z.coerce.number().int().refine((v) => v === 58 || v === 80, 'Largeur 58 ou 80 mm.'),
      type: z.enum(['epson', 'star', 'tanca', 'daruma', 'brother']),
      jeu_caracteres: z.string().trim().max(40),
      copies: z.coerce.number().int().min(1).max(5),
      couper: z.boolean(),
      tiroir: z.boolean(),
      fichier: z.string().trim().max(300),
    }),
    defaults: PRINT_DEFAULTS,
  },
};

settingsRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const { rows } = await getPool().query('SELECT key, value FROM app_settings');
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const settings = {};
    for (const [key, def] of Object.entries(SCHEMAS)) {
      settings[key] = { ...def.defaults, ...(stored[key] ?? {}) };
    }
    res.json({ settings });
  })
);

settingsRouter.put(
  '/settings/:key',
  validate({ params: z.object({ key: z.string() }) }),
  asyncHandler(async (req, res) => {
    const def = SCHEMAS[req.params.key];
    if (!def) throw errors.notFound('Paramètre inconnu.');

    const parsed = def.schema.safeParse({ ...def.defaults, ...req.body });
    if (!parsed.success) {
      throw errors.validation(parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    }

    const value = await withTx(async (c) => {
      await c.query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
                                         updated_by = EXCLUDED.updated_by,
                                         updated_at = now()`,
        [req.params.key, JSON.stringify(parsed.data), req.admin.id]
      );
      await writeAudit(c, {
        adminId: req.admin.id, action: 'settings.update', entity: 'app_setting',
        entityId: req.params.key, details: parsed.data, ip: req.ip,
      });
      return parsed.data;
    });

    res.json({ key: req.params.key, value });
  })
);
