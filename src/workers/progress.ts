import type { BulkAction, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { BULK_ACTION_STATUS, ITEM_STATUS } from '../config/constants';

type ActionCounts = Pick<
  BulkAction,
  'id' | 'isPlanned' | 'totalCount' | 'successCount' | 'failedCount' | 'skippedCount'
>;

function isDone(action: ActionCounts): boolean {
  const processed = action.successCount + action.failedCount + action.skippedCount;
  return action.isPlanned && processed >= action.totalCount;
}

// the status filter means only one caller can flip it, even if two batches finish together
export async function completeIfDone(tx: Prisma.TransactionClient, action: ActionCounts): Promise<void> {
  if (!isDone(action)) return;

  await tx.bulkAction.updateMany({
    where: { id: action.id, status: BULK_ACTION_STATUS.IN_PROGRESS },
    data: { status: BULK_ACTION_STATUS.COMPLETED, completedAt: new Date() },
  });
}

// the counter update locks the action row, so the last batch to commit
// always sees the final numbers and is the one that marks it completed
export async function addCounts(
  tx: Prisma.TransactionClient,
  bulkActionId: string,
  { success = 0, failed = 0 }: { success?: number; failed?: number },
): Promise<void> {
  const action = await tx.bulkAction.update({
    where: { id: bulkActionId },
    data: {
      successCount: { increment: success },
      failedCount: { increment: failed },
    },
  });

  await completeIfDone(tx, action);
}

// used when a batch ran out of retries, so the action can still finish
export async function failPendingRows(
  bulkActionId: string,
  fromRow: number,
  toRow: number,
  message: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.bulkActionItem.updateMany({
      where: { bulkActionId, rowNumber: { gte: fromRow, lte: toRow }, status: ITEM_STATUS.PENDING },
      data: { status: ITEM_STATUS.FAILED, message, processedAt: new Date() },
    });

    if (count) await addCounts(tx, bulkActionId, { failed: count });
  });
}

export async function markActionFailed(bulkActionId: string, message: string): Promise<void> {
  await prisma.bulkAction.updateMany({
    where: {
      id: bulkActionId,
      status: { in: [BULK_ACTION_STATUS.QUEUED, BULK_ACTION_STATUS.IN_PROGRESS] },
    },
    data: { status: BULK_ACTION_STATUS.FAILED, errorMessage: message, completedAt: new Date() },
  });
}
