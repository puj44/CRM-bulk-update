import type { BulkAction } from '@prisma/client';
import env from '../config/env';
import { batchQueue } from '../queues';
import { JOB_NAMES, JOB_ID_SEPARATOR } from '../config/constants';

type ActionRef = Pick<BulkAction, 'id' | 'entityType' | 'actionType'>;

// batches cover fixed row windows (1-1000, 1001-2000, ...), so a batch's job id only depends
// on where it sits, not on which rows happened to be pending. that's what lets the planner
// retry and the recovery sweep queue a batch again without doubling it up
export function batchStart(rowNumber: number): number {
  const { batchSize } = env.bulk;
  return Math.floor((rowNumber - 1) / batchSize) * batchSize + 1;
}

export function batchStartsFor(rowNumbers: number[]): number[] {
  return [...new Set(rowNumbers.map(batchStart))];
}

// jobs only carry a row range, the actual data stays in postgres.
// bullmq skips a job id it already has, so queueing a batch twice is a no-op
export async function queueBatches(action: ActionRef, starts: number[]): Promise<void> {
  const jobs = starts.map((fromRow) => ({
    name: JOB_NAMES.PROCESS_BATCH,
    data: {
      bulkActionId: action.id,
      entityType: action.entityType,
      actionType: action.actionType,
      fromRow,
      toRow: fromRow + env.bulk.batchSize - 1,
    },
    opts: { jobId: `${action.id}${JOB_ID_SEPARATOR}${fromRow}` },
  }));

  if (jobs.length) await batchQueue.addBulk(jobs);
}
