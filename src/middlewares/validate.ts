import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import AppError from '../utils/app-error';
import { listIssues } from '../utils/validation';
import { HTTP_STATUS, MESSAGES } from '../config/constants';

type Source = 'body' | 'query' | 'params';

// parses req[source] with a zod schema and puts the clean result on req.validated[source]
// (express 5 doesn't let us overwrite req.query, hence the separate object)
export default function validate(schema: ZodTypeAny, source: Source = 'body'): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});

    if (!result.success) {
      return next(new AppError(HTTP_STATUS.BAD_REQUEST, MESSAGES.VALIDATION_FAILED, listIssues(result.error)));
    }

    req.validated = { ...req.validated, [source]: result.data };
    return next();
  };
}
