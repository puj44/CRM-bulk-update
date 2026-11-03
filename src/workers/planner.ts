import { Prisma, type BulkAction, type ItemStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import env from '../config/env';
import prisma from '../lib/prisma';
import logger from '../lib/logger';
import type { PlanJobData } from '../queues';
import { getEntity, type EntityConfig } from '../entities';
import { getAction, type ActionHandler } from '../actions';
import { readRecordsInChunks, type NumberedRecord } from './record-reader';
import { completeIfDone } from './progress';
import { queueBatches, batchStartsFor } from './batch-jobs';
import { removeFile } from '../utils/files';
import { isUniqueViolation } from '../utils/prisma-errors';
import { BULK_ACTION_STATUS, ITEM_STATUS, MESSAGES } from '../config/constants';

interface PlannedItem {
  bulkActionId: string;
  rowNumber: number;
  entityId: number | null;
  data: Record<string, unknown>;
  status: ItemStatus;
  message?: string;
  processedAt?: Date;
  dedupeKey?: string | null;
  dedupeEntityId?: number | null;
}

interface EarlierOwner {
  rowNumber: number;
  dedupeEntityId: number | null;
  dedupeKey: string | null;
}

function buildItem(
  bulkActionId: string,
  handler: ActionHandler,
  entity: EntityConfig,
  { rowNumber, record }: NumberedRecord,
): PlannedItem {
  const parsed = handler.parseRecord(record, entity);

  if (parsed.error !== undefined) {
    return {
      bulkActionId,
      rowNumber,
      entityId: parsed.entityId ?? null,
      data: record,
      status: ITEM_STATUS.FAILED,
      message: parsed.error,
      processedAt: new Date(),
    };
  }

  return { bulkActionId, rowNumber, entityId: parsed.entityId, data: parsed.data, status: ITEM_STATUS.PENDING };
}

function getDedupeKey(entity: EntityConfig, item: PlannedItem): string | null {
  const value = entity.dedupeField ? item.data[entity.dedupeField] : null;
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim().toLowerCase();
}

function skip(item: PlannedItem, message: string) {
  item.status = ITEM_STATUS.SKIPPED;
  item.message = message;
  item.processedAt = new Date();
}

// one unique index lookup per key. a plain "IN (...) OR IN (...)" made postgres scan every
// saved row of the action while its stats were stale, so each chunk got slower than the last
async function findEarlierOwners(bulkActionId: string, entityIds: number[], keys: string[]): Promise<EarlierOwner[]> {
  const [byEntity, byKey] = await Promise.all([
    prisma.$queryRaw<EarlierOwner[]>`
      SELECT i.row_number AS "rowNumber", i.dedupe_entity_id AS "dedupeEntityId", NULL AS "dedupeKey"
      FROM unnest(${entityIds}::int[]) AS k(value)
      CROSS JOIN LATERAL (
        SELECT row_number, dedupe_entity_id FROM bulk_action_items
        WHERE bulk_action_id = ${bulkActionId}::uuid AND dedupe_entity_id = k.value
      ) AS i
    `,
    keys.length
      ? prisma.$queryRaw<EarlierOwner[]>`
          SELECT i.row_number AS "rowNumber", NULL::int AS "dedupeEntityId", i.dedupe_key AS "dedupeKey"
          FROM unnest(${keys}::text[]) AS k(value)
          CROSS JOIN LATERAL (
            SELECT row_number, dedupe_key FROM bulk_action_items
            WHERE bulk_action_id = ${bulkActionId}::uuid AND dedupe_key = k.value
          ) AS i
        `
      : [],
  ]);
  return [...byEntity, ...byKey];
}

// first row wins: a later row with the same entity id or the same email gets skipped.
// earlier chunks are already in the db, so we look those up, then walk this chunk in order
async function markDuplicates(bulkActionId: string, entity: EntityConfig, items: PlannedItem[]) {
  const candidates = items.filter((item) => item.status === ITEM_STATUS.PENDING);
  if (!candidates.length) return;

  // pending items always have an entity id, parseRecord made sure of that
  const entityIds = candidates.map((item) => item.entityId as number);
  const keys = candidates.map((item) => getDedupeKey(entity, item)).filter((key): key is string => Boolean(key));

  const earlier = await findEarlierOwners(bulkActionId, entityIds, keys);

  const entityOwners = new Map<number, number>();
  const keyOwners = new Map<string, number>();
  for (const row of earlier) {
    if (row.dedupeEntityId !== null) entityOwners.set(row.dedupeEntityId, row.rowNumber);
    if (row.dedupeKey !== null) keyOwners.set(row.dedupeKey, row.rowNumber);
  }

  for (const item of candidates) {
    const entityId = item.entityId as number;
    const key = getDedupeKey(entity, item);

    if (entityOwners.has(entityId)) {
      skip(item, MESSAGES.DUPLICATE_ENTITY(entity.label, entityOwners.get(entityId) as number));
    } else if (key && keyOwners.has(key)) {
      skip(item, MESSAGES.DUPLICATE_FIELD(entity.dedupeField as string, keyOwners.get(key) as number));
    } else {
      item.dedupeEntityId = entityId;
      item.dedupeKey = key;
      entityOwners.set(entityId, item.rowNumber);
      if (key) keyOwners.set(key, item.rowNumber);
    }
  }
}

// queues the batches of a chunk that's already in the db. false when the chunk isn't saved yet
async function queueSavedChunk(action: BulkAction, { firstRow, lastRow }: { firstRow: number; lastRow: number }) {
  const inThisChunk = { bulkActionId: action.id, rowNumber: { gte: firstRow, lte: lastRow } };

  const saved = await prisma.bulkActionItem.count({ where: inThisChunk });
  if (!saved) return false;

  const pending = await prisma.bulkActionItem.findMany({
    where: { ...inThisChunk, status: ITEM_STATUS.PENDING },
    select: { rowNumber: true },
    orderBy: { rowNumber: 'asc' },
  });
  await queueBatches(action, batchStartsFor(pending.map((row) => row.rowNumber)));
  return true;
}

async function planChunk({
  action,
  entity,
  handler,
  chunk,
}: {
  action: BulkAction;
  entity: EntityConfig;
  handler: ActionHandler;
  chunk: NumberedRecord[];
}) {
  const chunkRange = { firstRow: chunk[0].rowNumber, lastRow: chunk[chunk.length - 1].rowNumber };

  // a retried planner can hit a chunk it already saved. don't redo it, just make sure its batches are queued
  if (await queueSavedChunk(action, chunkRange)) return;

  const items = chunk.map((entry) => buildItem(action.id, handler, entity, entry));
  await markDuplicates(action.id, entity, items);

  const failed = items.filter((item) => item.status === ITEM_STATUS.FAILED).length;
  const skipped = items.filter((item) => item.status === ITEM_STATUS.SKIPPED).length;

  // rows and counters go in together, so a crash can't leave them out of sync
  try {
    await prisma.$transaction([
      prisma.bulkActionItem.createMany({ data: items as Prisma.BulkActionItemCreateManyInput[] }),
      prisma.bulkAction.update({
        where: { id: action.id },
        data: {
          totalCount: { increment: items.length },
          failedCount: { increment: failed },
          skippedCount: { increment: skipped },
        },
      }),
    ]);
  } catch (err) {
    // another planner saved this chunk first. that only happens when redis lost the job while it
    // was running and recovery queued a second one. nothing of ours got in, so treat it as saved
    if (isUniqueViolation(err) && (await queueSavedChunk(action, chunkRange))) return;
    throw err;
  }

  const pendingRows = items.filter((item) => item.status === ITEM_STATUS.PENDING).map((item) => item.rowNumber);
  await queueBatches(action, batchStartsFor(pendingRows));
}

async function finishPlanning(action: BulkAction) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.bulkAction.update({
      where: { id: action.id },
      // records are in the items table now, no need to keep a second copy
      data: { isPlanned: true, records: Prisma.DbNull },
    });
    await completeIfDone(tx, updated);
  });

  if (action.filePath) await removeFile(action.filePath);
}

export async function planBulkAction(job: Job<PlanJobData>): Promise<void> {
  const { bulkActionId } = job.data;
  const action = await prisma.bulkAction.findUnique({ where: { id: bulkActionId } });

  if (!action) {
    logger.warn({ bulkActionId }, 'bulk action not found, dropping plan job');
    return;
  }
  if (action.status === BULK_ACTION_STATUS.COMPLETED || action.status === BULK_ACTION_STATUS.FAILED) return;

  const entity = getEntity(action.entityType);
  const handler = getAction(action.actionType);
  if (!entity || !handler) throw new Error(MESSAGES.UNSUPPORTED(action.entityType, action.actionType));

  await prisma.bulkAction.updateMany({
    where: { id: action.id, status: BULK_ACTION_STATUS.QUEUED },
    data: { status: BULK_ACTION_STATUS.IN_PROGRESS, startedAt: new Date() },
  });

  if (!action.isPlanned) {
    for await (const chunk of readRecordsInChunks(action, env.bulk.plannerChunkSize)) {
      await planChunk({ action, entity, handler, chunk });
    }
  }

  await finishPlanning(action);
  logger.info({ bulkActionId }, 'planning done');
}
