import { Prisma } from '@prisma/client';
import {
  ROW_LEVEL_PRISMA_CODES,
  RAW_QUERY_FAILED_CODE,
  ROW_LEVEL_SQLSTATE_PREFIXES,
  UNIQUE_VIOLATION_CODE,
} from '../config/constants';

// true when a row's data broke the query (bad value, constraint),
// false for things like a lost connection where retrying the whole job makes sense
export function isRowLevelError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;

  if (err.code === RAW_QUERY_FAILED_CODE) {
    const sqlState = String(err.meta?.code ?? '');
    return ROW_LEVEL_SQLSTATE_PREFIXES.some((prefix) => sqlState.startsWith(prefix));
  }

  return ROW_LEVEL_PRISMA_CODES.includes(err.code);
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION_CODE;
}

// prisma messages are a few lines long, the last line is the useful bit
export function shortErrorMessage(err: unknown): string {
  const known = err as { meta?: { message?: unknown }; message?: unknown } | null | undefined;
  const message = String(known?.meta?.message || known?.message || err);
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] || message;
}
