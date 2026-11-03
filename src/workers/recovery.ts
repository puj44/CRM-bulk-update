import env from '../config/env';
import prisma from '../lib/prisma';
import { plannerQueue } from '../queues';
import { queueBatches } from './batch-jobs';
import { BULK_ACTION_STATUS, ITEM_STATUS, JOB_NAMES } from '../config/constants';

// postgres has the real state, redis only holds the work queue. if redis loses its jobs
// (flushed, or restarted without persistence) nothing would ever pick unfinished actions up
// again, so this puts their jobs back. job ids are fixed, so a job that's still there is left alone
// and re-running work that's already done changes nothing
export async function recoverUnfinishedActions(): Promise<number> {
  const actions = await prisma.bulkAction.findMany({
    where: { status: { in: [BULK_ACTION_STATUS.QUEUED, BULK_ACTION_STATUS.IN_PROGRESS] } },
    select: { id: true, entityType: true, actionType: true, isPlanned: true },
  });

  for (const action of actions) {
    if (!action.isPlanned) {
      // the planner picks up where it left off: chunks it already saved just get their batches queued again
      await plannerQueue.add(JOB_NAMES.PLAN, { bulkActionId: action.id }, { jobId: action.id });
      continue;
    }

    // planning is done, so whatever is still pending needs its batch. one row per batch window,
    // not per pending row, so this stays small even for a huge action
    const { batchSize } = env.bulk;
    const windows = await prisma.$queryRaw<{ fromRow: number }[]>`
      SELECT DISTINCT ((row_number - 1) / ${batchSize}::int) * ${batchSize}::int + 1 AS "fromRow"
      FROM bulk_action_items
      WHERE bulk_action_id = ${action.id}::uuid AND status = ${ITEM_STATUS.PENDING}::"ItemStatus"
    `;
    await queueBatches(action, windows.map((window) => window.fromRow));
  }

  return actions.length;
}
