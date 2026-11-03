import { Worker, type Job } from 'bullmq';
import env from './config/env';
import logger from './lib/logger';
import prisma from './lib/prisma';
import redis from './lib/redis';
import { plannerQueue, batchQueue, type PlanJobData, type BatchJobData } from './queues';
import { planBulkAction } from './workers/planner';
import { processBatch, type BatchTotals } from './workers/batch';
import { markActionFailed, failPendingRows } from './workers/progress';
import { recoverUnfinishedActions } from './workers/recovery';
import { shortErrorMessage } from './utils/prisma-errors';
import { QUEUE_NAMES, MESSAGES, FINAL_FAILED_STATE } from './config/constants';

const plannerWorker = new Worker<PlanJobData>(QUEUE_NAMES.PLANNER, planBulkAction, {
  connection: redis,
  concurrency: env.workers.plannerConcurrency,
});

const batchWorker = new Worker<BatchJobData, BatchTotals>(QUEUE_NAMES.BATCHES, processBatch, {
  connection: redis,
  concurrency: env.workers.batchConcurrency,
});

// "failed" fires on every failed attempt, we only care once retries are used up
async function isFinalFailure(job: Job): Promise<boolean> {
  return (await job.getState()) === FINAL_FAILED_STATE;
}

plannerWorker.on('failed', async (job, err) => {
  logger.error({ jobId: job?.id, attempt: job?.attemptsMade, reason: err.message }, 'planner job failed');
  try {
    if (job && (await isFinalFailure(job))) await markActionFailed(job.data.bulkActionId, shortErrorMessage(err));
  } catch (handlerErr) {
    logger.error({ err: handlerErr }, 'could not mark bulk action as failed');
  }
});

batchWorker.on('failed', async (job, err) => {
  logger.error({ jobId: job?.id, attempt: job?.attemptsMade, reason: err.message }, 'batch job failed');
  try {
    if (job && (await isFinalFailure(job))) {
      const { bulkActionId, fromRow, toRow } = job.data;
      await failPendingRows(bulkActionId, fromRow, toRow, MESSAGES.GAVE_UP(shortErrorMessage(err)));
    }
  } catch (handlerErr) {
    logger.error({ err: handlerErr }, 'could not fail pending rows');
  }
});

batchWorker.on('completed', (job, result) => {
  logger.debug({ jobId: job.id, ...result }, 'batch done');
});

for (const worker of [plannerWorker, batchWorker]) {
  worker.on('error', (err) => logger.error({ err: err.message }, 'worker error'));
}

logger.info(
  { planner: env.workers.plannerConcurrency, batches: env.workers.batchConcurrency },
  'workers started',
);

// puts back jobs redis lost: once on startup, then every RECOVERY_INTERVAL_MS.
// every worker runs it, that's fine since it never queues a job twice
let recovering = false;

async function recover() {
  if (recovering) return;
  recovering = true;
  try {
    const unfinished = await recoverUnfinishedActions();
    if (unfinished) logger.info({ unfinished }, 'recovery checked unfinished actions');
  } catch (err) {
    logger.error({ err }, 'recovery failed, will try again on the next run');
  } finally {
    recovering = false;
  }
}

recover();
const recoveryTimer = setInterval(recover, env.workers.recoveryIntervalMs);

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, finishing running jobs`);

  // whatever is still running after this gets picked up again by another worker (stalled job)
  setTimeout(() => process.exit(1), env.workers.shutdownTimeoutMs).unref();
  clearInterval(recoveryTimer);

  await Promise.allSettled([plannerWorker.close(), batchWorker.close()]);
  await Promise.allSettled([plannerQueue.close(), batchQueue.close()]);
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
