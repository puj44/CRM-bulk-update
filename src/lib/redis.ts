import Redis from 'ioredis';
import env from '../config/env';
import logger from './logger';

// shared by queues, workers and the rate limiter.
// bullmq needs maxRetriesPerRequest = null, workers make their own blocking copy of it
const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: null });

redis.on('error', (err) => logger.error({ err: err.message }, 'redis connection error'));

export default redis;
