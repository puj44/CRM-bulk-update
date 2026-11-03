import { z } from 'zod';
import env from '../../config/env';
import { entityTypes } from '../../entities';
import { actionTypes } from '../../actions';
import { asNumber, enumValues } from '../../utils/validation';
import {
  BULK_ACTION_STATUS,
  ITEM_STATUS,
  FIELD_LIMITS,
  ACCOUNT_ID_PATTERN,
  PAGINATION,
} from '../../config/constants';

const accountId = z.string().trim().min(1).max(FIELD_LIMITS.ACCOUNT_ID_MAX).regex(ACCOUNT_ID_PATTERN);

const pageNumber = (fallback: number, max?: number) =>
  z.preprocess(asNumber, z.number().int().min(1).max(max ?? Number.MAX_SAFE_INTEGER).default(fallback));

// the outer shape only. each record's fields are checked later by the planner,
// so one bad row fails on its own instead of rejecting the whole request
export const createBulkActionSchema = z.object({
  accountId,
  entityType: z.enum(entityTypes),
  actionType: z.enum(actionTypes),
  records: z.array(z.record(z.unknown())).min(1).max(env.bulk.maxJsonRecords).optional(),
});

export const listBulkActionsSchema = z.object({
  status: z.enum(enumValues(BULK_ACTION_STATUS)).optional(),
  accountId: accountId.optional(),
  page: pageNumber(PAGINATION.DEFAULT_PAGE),
  limit: pageNumber(PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT),
});

export const bulkActionIdSchema = z.object({
  id: z.string().uuid(),
});

export const logsQuerySchema = z.object({
  status: z.enum(enumValues(ITEM_STATUS)).optional(),
  entityId: z.preprocess(asNumber, z.number().int().positive()).optional(),
  // last row number from the previous page
  cursor: z.preprocess(asNumber, z.number().int().min(0)).optional(),
  limit: pageNumber(PAGINATION.LOGS_DEFAULT_LIMIT, PAGINATION.LOGS_MAX_LIMIT),
});

export type CreateBulkActionInput = z.infer<typeof createBulkActionSchema>;
export type ListBulkActionsQuery = z.infer<typeof listBulkActionsSchema>;
export type BulkActionIdParams = z.infer<typeof bulkActionIdSchema>;
export type LogsQuery = z.infer<typeof logsQuerySchema>;
