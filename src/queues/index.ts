import { Queue } from 'bullmq';
import env from '../config/env';
import redis from '../lib/redis';
import { QUEUE_NAMES } from '../config/constants';

export interface PlanJobData {
  bulkActionId: string;
}

// a batch only carries a row range, the rows themselves stay in postgres
export interface BatchJobData {
  bulkActionId: string;
  entityType: string;
  actionType: string;
  fromRow: number;
  toRow: number;
}

const defaultJobOptions = {
  attempts: env.jobs.attempts,
  backoff: { type: 'exponential', delay: env.jobs.backoffMs },
  removeOnComplete: { count: env.jobs.keepCompleted },
  removeOnFail: { count: env.jobs.keepFailed },
};

// one job per bulk action, reads the records and splits them into batches
export const plannerQueue = new Queue<PlanJobData>(QUEUE_NAMES.PLANNER, { connection: redis, defaultJobOptions });

// one job per batch of rows
export const batchQueue = new Queue<BatchJobData>(QUEUE_NAMES.BATCHES, { connection: redis, defaultJobOptions });
