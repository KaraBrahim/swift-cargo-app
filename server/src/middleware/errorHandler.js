import { AppError } from '../lib/AppError.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route introuvable.' } });
}

// Central error handler — the ONLY place that formats an error response.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
  }

  // Map a few well-known Postgres errors to clean 409s instead of a raw 500.
  if (err && err.code === '23505') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Doublon détecté.' } });
  }
  if (err && err.code === '23514') {
    return res
      .status(409)
      .json({ error: { code: 'CONSTRAINT', message: 'Opération refusée (contrainte).' } });
  }

  // Anything else is unexpected: log full detail, return a safe generic message.
  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err?.stack || err);
  return res
    .status(500)
    .json({ error: { code: 'INTERNAL', message: 'Erreur interne du serveur.' } });
}
