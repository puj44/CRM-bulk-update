import type { Prisma } from '@prisma/client';
import type { EntityConfig } from '../entities/types';

export type RawRecord = Record<string, unknown>;

export type ParsedRecord =
  | { entityId: number | null; error: string; data?: undefined }
  | { entityId: number; data: Record<string, unknown>; error?: undefined };

// a pending row as the batch worker hands it to applyBatch
export interface BatchRow {
  rowNumber: number;
  entityId: number;
  data: Record<string, unknown>;
}

export type RowResult = { rowNumber: number; ok: true } | { rowNumber: number; ok: false; message: string };

// every action implements this. planner, batches, retries, logs and stats are shared
export interface ActionHandler {
  type: string;
  requiredFields: string[];
  getAllowedFields(entity: EntityConfig): string[];
  parseRecord(record: RawRecord, entity: EntityConfig): ParsedRecord;
  applyBatch(args: { tx: Prisma.TransactionClient; entity: EntityConfig; rows: BatchRow[] }): Promise<RowResult[]>;
}
