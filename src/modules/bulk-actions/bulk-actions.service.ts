import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import logger from '../../lib/logger';
import { plannerQueue } from '../../queues';
import { getEntity, type EntityConfig } from '../../entities';
import { getAction, type ActionHandler } from '../../actions';
import AppError from '../../utils/app-error';
import { readFileHeader, isZipFile, uploadTypeOf } from '../../utils/files';
import {
  type FileSourceType,
  BULK_ACTION_STATUS,
  SOURCE_TYPE,
  JOB_NAMES,
  HTTP_STATUS,
  MESSAGES,
  PERCENT_DECIMALS,
  FULL_PERCENT,
} from '../../config/constants';
import type { CreateBulkActionInput, ListBulkActionsQuery, LogsQuery } from './bulk-actions.validation';

// never send the raw records / file path back
const bulkActionFields = {
  id: true,
  accountId: true,
  entityType: true,
  actionType: true,
  status: true,
  sourceType: true,
  totalCount: true,
  successCount: true,
  failedCount: true,
  skippedCount: true,
  isPlanned: true,
  errorMessage: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
} as const satisfies Prisma.BulkActionSelect;

const logFields = {
  rowNumber: true,
  entityId: true,
  status: true,
  message: true,
  data: true,
  processedAt: true,
} as const satisfies Prisma.BulkActionItemSelect;

type BulkActionRow = Prisma.BulkActionGetPayload<{ select: typeof bulkActionFields }>;

function toPercent(part: number, whole: number): number {
  if (!whole) return 0;
  return Number(((part / whole) * FULL_PERCENT).toFixed(PERCENT_DECIMALS));
}

function getCounts(action: BulkActionRow) {
  const processed = action.successCount + action.failedCount + action.skippedCount;
  return {
    total: action.totalCount,
    success: action.successCount,
    failed: action.failedCount,
    skipped: action.skippedCount,
    pending: Math.max(action.totalCount - processed, 0),
    percent: action.isPlanned && action.totalCount === 0 ? FULL_PERCENT : toPercent(processed, action.totalCount),
    // false while the planner is still reading records, total can still grow
    allRecordsRead: action.isPlanned,
  };
}

function formatBulkAction(action: BulkActionRow) {
  return {
    id: action.id,
    accountId: action.accountId,
    entityType: action.entityType,
    actionType: action.actionType,
    status: action.status,
    sourceType: action.sourceType,
    progress: getCounts(action),
    errorMessage: action.errorMessage,
    createdAt: action.createdAt,
    startedAt: action.startedAt,
    completedAt: action.completedAt,
  };
}

async function findBulkAction(id: string): Promise<BulkActionRow> {
  const action = await prisma.bulkAction.findUnique({ where: { id }, select: bulkActionFields });
  if (!action) throw new AppError(HTTP_STATUS.NOT_FOUND, MESSAGES.BULK_ACTION_NOT_FOUND);
  return action;
}

interface UploadedFile {
  path: string;
  type: FileSourceType;
}

// a renamed or broken file shouldn't get as far as the planner
async function readHeader(filePath: string, type: FileSourceType): Promise<string[]> {
  if (type !== SOURCE_TYPE.XLSX) return readFileHeader(filePath, type);

  if (!(await isZipFile(filePath))) throw new AppError(HTTP_STATUS.BAD_REQUEST, MESSAGES.NOT_AN_XLSX);
  try {
    return await readFileHeader(filePath, type);
  } catch {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, MESSAGES.NOT_AN_XLSX);
  }
}

// catch a wrong file before we queue anything
async function checkFileColumns(file: UploadedFile, handler: ActionHandler, entity: EntityConfig) {
  const header = await readHeader(file.path, file.type);
  const allowed = handler.getAllowedFields(entity);

  const missing = handler.requiredFields.filter((column) => !header.includes(column));
  if (missing.length) throw new AppError(HTTP_STATUS.BAD_REQUEST, MESSAGES.FILE_MISSING_COLUMNS(missing));

  const unknown = header.filter((column) => !allowed.includes(column));
  if (unknown.length) throw new AppError(HTTP_STATUS.BAD_REQUEST, MESSAGES.FILE_UNKNOWN_COLUMNS(unknown, allowed));
}

export async function createBulkAction(input: CreateBulkActionInput, file?: Express.Multer.File) {
  if (!input.records && !file) throw new AppError(HTTP_STATUS.BAD_REQUEST, MESSAGES.RECORDS_OR_FILE_REQUIRED);
  if (input.records && file) throw new AppError(HTTP_STATUS.BAD_REQUEST, MESSAGES.RECORDS_AND_FILE);

  // both were checked against the registries by the request schema
  const entity = getEntity(input.entityType) as EntityConfig;
  const handler = getAction(input.actionType) as ActionHandler;

  // the upload filter only lets supported extensions through
  const upload = file && { path: file.path, type: uploadTypeOf(file.originalname) as FileSourceType };
  if (upload) await checkFileColumns(upload, handler, entity);

  const action = await prisma.bulkAction.create({
    data: {
      accountId: input.accountId,
      entityType: input.entityType,
      actionType: input.actionType,
      sourceType: upload ? upload.type : SOURCE_TYPE.JSON,
      records: file ? undefined : (input.records as Prisma.InputJsonValue),
      filePath: file ? file.path : null,
    },
    select: bulkActionFields,
  });

  try {
    await plannerQueue.add(JOB_NAMES.PLAN, { bulkActionId: action.id }, { jobId: action.id });
  } catch (err) {
    logger.error({ err, bulkActionId: action.id }, 'could not queue bulk action');
    await prisma.bulkAction.update({
      where: { id: action.id },
      data: { status: BULK_ACTION_STATUS.FAILED, errorMessage: MESSAGES.QUEUE_UNAVAILABLE, completedAt: new Date() },
    });
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, MESSAGES.QUEUE_UNAVAILABLE);
  }

  logger.info({ bulkActionId: action.id, source: action.sourceType }, 'bulk action queued');
  return formatBulkAction(action);
}

export async function listBulkActions({ status, accountId, page, limit }: ListBulkActionsQuery) {
  const where: Prisma.BulkActionWhereInput = {
    ...(status && { status }),
    ...(accountId && { accountId }),
  };

  const [actions, total] = await prisma.$transaction([
    prisma.bulkAction.findMany({
      where,
      select: bulkActionFields,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.bulkAction.count({ where }),
  ]);

  return {
    data: actions.map(formatBulkAction),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getBulkAction(id: string) {
  return formatBulkAction(await findBulkAction(id));
}

export async function getBulkActionStats(id: string) {
  const action = await findBulkAction(id);
  return { id: action.id, status: action.status, ...getCounts(action) };
}

// cursor pagination on row number, so page 1000 costs the same as page 1
export async function getBulkActionLogs(id: string, { status, entityId, cursor, limit }: LogsQuery) {
  await findBulkAction(id);

  const rows = await prisma.bulkActionItem.findMany({
    where: {
      bulkActionId: id,
      ...(status && { status }),
      ...(entityId && { entityId }),
      ...(cursor !== undefined && { rowNumber: { gt: cursor } }),
    },
    select: logFields,
    orderBy: { rowNumber: 'asc' },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: page.map((row) => ({
      row: row.rowNumber,
      entityId: row.entityId,
      status: row.status,
      message: row.message,
      data: row.data,
      processedAt: row.processedAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].rowNumber : null,
  };
}
