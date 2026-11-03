import type { RequestHandler } from 'express';
import AppError from '../utils/app-error';
import { HTTP_STATUS, MESSAGES } from '../config/constants';

const notFound: RequestHandler = (req, res, next) => {
  next(new AppError(HTTP_STATUS.NOT_FOUND, MESSAGES.ROUTE_NOT_FOUND));
};

export default notFound;
