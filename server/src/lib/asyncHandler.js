// Wrap async route handlers so any thrown/rejected error reaches the central
// error middleware instead of crashing the process (unhandled rejection).
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
