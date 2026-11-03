import multer from 'multer';
import type { ErrorRequestHandler } from 'express';
import logger from '../lib/logger';
import AppError from '../utils/app-error';
import { removeFile } from '../utils/files';
import { HTTP_STATUS, MESSAGES, BODY_ERRORS, MULTER_FILE_TOO_LARGE } from '../config/constants';

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;

  if (err instanceof multer.MulterError) {
    return err.code === MULTER_FILE_TOO_LARGE
      ? new AppError(HTTP_STATUS.PAYLOAD_TOO_LARGE, MESSAGES.FILE_TOO_LARGE)
      : new AppError(HTTP_STATUS.BAD_REQUEST, err.message);
  }

  // body-parser tags its errors with a "type"
  const type = (err as { type?: unknown } | null)?.type;
  if (type === BODY_ERRORS.TOO_LARGE) return new AppError(HTTP_STATUS.PAYLOAD_TOO_LARGE, MESSAGES.BODY_TOO_LARGE);
  if (type === BODY_ERRORS.PARSE_FAILED) return new AppError(HTTP_STATUS.BAD_REQUEST, MESSAGES.INVALID_JSON);

  return null;
}

// express spots error handlers by their 4 arguments, so next has to stay even though it's unused
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // an upload that ended in an error is of no use, don't leave it on disk
  if (req.file) {
    removeFile(req.file.path).catch((removeErr: Error) =>
      logger.warn({ err: removeErr.message }, 'could not remove upload'),
    );
  }

  const known = toAppError(err);

  if (!known) {
    logger.error({ err, path: req.path }, 'unhandled error');
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: { message: MESSAGES.SOMETHING_WENT_WRONG } });
    return;
  }

  res.status(known.statusCode).json({
    error: { message: known.message, ...(known.details && { details: known.details }) },
  });
};

export default errorHandler;
