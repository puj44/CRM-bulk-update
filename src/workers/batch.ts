import type { Job } from 'bullmq';
import env from '../config/env';
import prisma from '../lib/prisma';
import logger from '../lib/logger';
import type { BatchJobData } from '../queues';
import { getEntity, type EntityConfig } from '../entities';
import { getAction, type ActionHandler, type BatchRow, type RowResult } from '../actions';
import { addCounts } from './progress';
import { isRowLevelError, shortErrorMessage } from '../utils/prisma-errors';
import { ITEM_STATUS, MESSAGES } from '../config/constants';
import type { Prisma } from '@prisma/client';

export interface BatchTotals {
  success: number;
  failed: number;
}

const txOptions = {
  timeout: env.workers.batchTxTimeoutMs,
  maxWait: env.workers.batchTxMaxWaitMs,
};

function groupFailuresByMessage(results: RowResult[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const result of results) {
    if (result.ok) continue;
    const rowNumbers = groups.get(result.message) ?? [];
    rowNumbers.push(result.rowNumber);
    groups.set(result.message, rowNumbers);
  }
  return groups;
}

// only rows still pending get moved, so the counts are exact even if a batch runs twice
async function saveResults(
  tx: Prisma.TransactionClient,
  bulkActionId: string,
  results: RowResult[],
): Promise<BatchTotals> {
  const processedAt = new Date();
  let success = 0;
  let failed = 0;

  const okRows = results.filter((result) => result.ok).map((result) => result.rowNumber);
  if (okRows.length) {
    const { count } = await tx.bulkActionItem.updateMany({
      where: { bulkActionId, rowNumber: { in: okRows }, status: ITEM_STATUS.PENDING },
      data: { status: ITEM_STATUS.SUCCESS, processedAt },
    });
    success = count;
  }

  // failures in one batch usually share a message ("contact not found"), so this is a query or two
  for (const [message, rowNumbers] of groupFailuresByMessage(results)) {
    const { count } = await tx.bulkActionItem.updateMany({
      where: { bulkActionId, rowNumber: { in: rowNumbers }, status: ITEM_STATUS.PENDING },
      data: { status: ITEM_STATUS.FAILED, message, processedAt },
    });
    failed += count;
  }

  await addCounts(tx, bulkActionId, { success, failed });
  return { success, failed };
}

function runRows(
  bulkActionId: string,
  entity: EntityConfig,
  handler: ActionHandler,
  rows: BatchRow[],
): Promise<BatchTotals> {
  return prisma.$transaction(async (tx) => {
    const results = await handler.applyBatch({ tx, entity, rows });
    return saveResults(tx, bulkActionId, results);
  }, txOptions);
}

// slow path: one bad row broke the batch query, so find it by going row by row
async function runOneByOne(
  bulkActionId: string,
  entity: EntityConfig,
  handler: ActionHandler,
  rows: BatchRow[],
): Promise<BatchTotals> {
  const totals = { success: 0, failed: 0 };

  for (const row of rows) {
    let result: BatchTotals;
    try {
      result = await runRows(bulkActionId, entity, handler, [row]);
    } catch (err) {
      if (!isRowLevelError(err)) throw err;
      const failure: RowResult = { rowNumber: row.rowNumber, ok: false, message: shortErrorMessage(err) };
      result = await prisma.$transaction((tx) => saveResults(tx, bulkActionId, [failure]), txOptions);
    }
    totals.success += result.success;
    totals.failed += result.failed;
  }

  return totals;
}

export async function processBatch(job: Job<BatchJobData>): Promise<BatchTotals> {
  const { bulkActionId, entityType, actionType, fromRow, toRow } = job.data;
  const entity = getEntity(entityType);
  const handler = getAction(actionType);
  if (!entity || !handler) throw new Error(MESSAGES.UNSUPPORTED(entityType, actionType));

  // pending rows always have an entity id and parsed data, the planner only queues those
  const rows = (await prisma.bulkActionItem.findMany({
    where: { bulkActionId, rowNumber: { gte: fromRow, lte: toRow }, status: ITEM_STATUS.PENDING },
    select: { rowNumber: true, entityId: true, data: true },
    orderBy: { rowNumber: 'asc' },
  })) as BatchRow[];

  // nothing pending means an earlier attempt already finished this batch
  if (!rows.length) return { success: 0, failed: 0 };

  try {
    return await runRows(bulkActionId, entity, handler, rows);
  } catch (err) {
    // connection drops, deadlocks, timeouts etc. -> throw and let bullmq retry the whole batch
    if (!isRowLevelError(err)) throw err;

    logger.warn({ bulkActionId, fromRow, toRow, reason: shortErrorMessage(err) }, 'batch query failed, going row by row');
    return runOneByOne(bulkActionId, entity, handler, rows);
  }
}
