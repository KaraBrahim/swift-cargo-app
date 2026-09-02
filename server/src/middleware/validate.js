// Zod-based request validation. Replaces req.body/params/query with the parsed,
// typed values, or throws a VALIDATION AppError with field-level details.
import { errors } from '../lib/AppError.js';

export const validate = (schemas) => (req, _res, next) => {
  try {
    for (const part of ['body', 'params', 'query']) {
      if (schemas[part]) {
        const result = schemas[part].safeParse(req[part]);
        if (!result.success) {
          const details = result.error.issues.map((i) => ({
            field: i.path.join('.') || part,
            message: i.message,
          }));
          throw errors.validation(details);
        }
        // query is a getter-only in Express 5; assign to a mutable stash instead.
        if (part === 'query') req.validatedQuery = result.data;
        else req[part] = result.data;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};
