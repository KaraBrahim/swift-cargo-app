// Single typed error the whole app throws. The central error handler turns it
// into a clean JSON response { error: { code, message, details } }. Anything
// that is NOT an AppError is treated as an unexpected 500 and logged.
export class AppError extends Error {
  constructor(code, message, { status = 400, details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// French messages — the system UI language.
export const errors = {
  validation: (details) =>
    new AppError('VALIDATION', 'Requête invalide.', { status: 400, details }),
  invalidAmount: (msg = 'Montant invalide.') =>
    new AppError('INVALID_AMOUNT', msg, { status: 400 }),
  unauthorized: (msg = 'Authentification requise.') =>
    new AppError('UNAUTHORIZED', msg, { status: 401 }),
  forbidden: (msg = 'Accès refusé.') =>
    new AppError('FORBIDDEN', msg, { status: 403 }),
  notFound: (msg = 'Ressource introuvable.') =>
    new AppError('NOT_FOUND', msg, { status: 404 }),
  conflict: (msg = 'Conflit.') => new AppError('CONFLICT', msg, { status: 409 }),
  tooManyRequests: (msg = 'Trop de tentatives. Réessayez plus tard.', details = null) =>
    new AppError('TOO_MANY_REQUESTS', msg, { status: 429, details }),
  insufficientFunds: (details) =>
    new AppError('INSUFFICIENT_FUNDS', 'Solde insuffisant.', {
      status: 409,
      details,
    }),
  noRate: (currency) =>
    new AppError(
      'NO_RATE',
      `Aucun taux de change défini pour ${currency}.`,
      { status: 409, details: { currency } }
    ),
};
