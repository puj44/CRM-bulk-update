import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { BYTES_PER_MB, ENV_LIMITS, MESSAGES } from './constants';

dotenv.config();

// env vars are always strings, so parse them explicitly instead of using defaults
const whole = (min: number, max: number = Number.MAX_SAFE_INTEGER) =>
  z
    .string({ required_error: MESSAGES.REQUIRED })
    .regex(/^\d+$/, MESSAGES.MUST_BE_NUMBER)
    .transform(Number)
    .pipe(z.number().min(min).max(max));

const text = z.string({ required_error: MESSAGES.REQUIRED }).trim().min(1, MESSAGES.REQUIRED);
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: whole(1, ENV_LIMITS.MAX_PORT),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),
  LOG_PRETTY: flag,

  DATABASE_URL: text,
  REDIS_URL: text,

  CORS_ORIGIN: text,
  TRUST_PROXY: whole(0),
  JSON_BODY_LIMIT: text,
  RATE_LIMIT_WINDOW_MS: whole(1),
  RATE_LIMIT_MAX: whole(1),
  CREATE_RATE_LIMIT_MAX: whole(1),

  UPLOAD_DIR: text,
  MAX_UPLOAD_SIZE_MB: whole(1, ENV_LIMITS.MAX_UPLOAD_SIZE_MB),

  MAX_JSON_RECORDS: whole(1, ENV_LIMITS.MAX_JSON_RECORDS),
  PLANNER_CHUNK_SIZE: whole(1, ENV_LIMITS.MAX_PLANNER_CHUNK_SIZE),
  BATCH_SIZE: whole(1, ENV_LIMITS.MAX_BATCH_SIZE),
  PLANNER_CONCURRENCY: whole(1, ENV_LIMITS.MAX_CONCURRENCY),
  BATCH_CONCURRENCY: whole(1, ENV_LIMITS.MAX_CONCURRENCY),
  BATCH_TX_TIMEOUT_MS: whole(1),
  BATCH_TX_MAX_WAIT_MS: whole(1),
  RECOVERY_INTERVAL_MS: whole(1),

  JOB_ATTEMPTS: whole(1),
  JOB_BACKOFF_MS: whole(0),
  KEEP_COMPLETED_JOBS: whole(0),
  KEEP_FAILED_JOBS: whole(0),
  SHUTDOWN_TIMEOUT_MS: whole(1),
})
  // batches are fixed row windows. if a window could span two planner chunks, the first chunk
  // would queue it before the second chunk's rows exist and those rows would never be picked up
  .refine((vars) => vars.PLANNER_CHUNK_SIZE % vars.BATCH_SIZE === 0, {
    message: MESSAGES.CHUNK_NOT_MULTIPLE_OF_BATCH,
    path: ['PLANNER_CHUNK_SIZE'],
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  // logger isn't ready yet (it needs this file), so plain console it is
  console.error(`Invalid environment config, check your .env file:\n${problems.join('\n')}`);
  process.exit(1);
}

const vars = parsed.data;

const env = Object.freeze({
  nodeEnv: vars.NODE_ENV,
  isProduction: vars.NODE_ENV === 'production',
  port: vars.PORT,
  logLevel: vars.LOG_LEVEL,
  logPretty: vars.LOG_PRETTY,

  databaseUrl: vars.DATABASE_URL,
  redisUrl: vars.REDIS_URL,

  corsOrigin: vars.CORS_ORIGIN === '*' ? '*' : vars.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
  trustProxy: vars.TRUST_PROXY,
  jsonBodyLimit: vars.JSON_BODY_LIMIT,

  rateLimit: Object.freeze({
    windowMs: vars.RATE_LIMIT_WINDOW_MS,
    max: vars.RATE_LIMIT_MAX,
    createMax: vars.CREATE_RATE_LIMIT_MAX,
  }),

  upload: Object.freeze({
    dir: path.resolve(vars.UPLOAD_DIR),
    maxFileSize: vars.MAX_UPLOAD_SIZE_MB * BYTES_PER_MB,
  }),

  bulk: Object.freeze({
    maxJsonRecords: vars.MAX_JSON_RECORDS,
    plannerChunkSize: vars.PLANNER_CHUNK_SIZE,
    batchSize: vars.BATCH_SIZE,
  }),

  workers: Object.freeze({
    plannerConcurrency: vars.PLANNER_CONCURRENCY,
    batchConcurrency: vars.BATCH_CONCURRENCY,
    batchTxTimeoutMs: vars.BATCH_TX_TIMEOUT_MS,
    batchTxMaxWaitMs: vars.BATCH_TX_MAX_WAIT_MS,
    recoveryIntervalMs: vars.RECOVERY_INTERVAL_MS,
    shutdownTimeoutMs: vars.SHUTDOWN_TIMEOUT_MS,
  }),

  jobs: Object.freeze({
    attempts: vars.JOB_ATTEMPTS,
    backoffMs: vars.JOB_BACKOFF_MS,
    keepCompleted: vars.KEEP_COMPLETED_JOBS,
    keepFailed: vars.KEEP_FAILED_JOBS,
  }),
});

export default env;
