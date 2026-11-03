import { rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import env from '../config/env';
import redis from '../lib/redis';
import AppError from '../utils/app-error';
import { HTTP_STATUS, MESSAGES, RATE_LIMIT_PREFIX } from '../config/constants';

// counts live in redis so the limit holds across every api instance
function buildLimiter(prefix: string, limit: number) {
  return rateLimit({
    windowMs: env.rateLimit.windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new RedisStore({
      prefix,
      sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
    }),
    handler: (req, res, next) => next(new AppError(HTTP_STATUS.TOO_MANY_REQUESTS, MESSAGES.TOO_MANY_REQUESTS)),
  });
}

export const apiLimiter = buildLimiter(RATE_LIMIT_PREFIX.API, env.rateLimit.max);

// creating an action is the expensive call, so it gets a tighter limit
export const createLimiter = buildLimiter(RATE_LIMIT_PREFIX.CREATE, env.rateLimit.createMax);
