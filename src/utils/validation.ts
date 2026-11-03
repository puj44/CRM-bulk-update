import type { ZodError } from 'zod';
import { MAX_VALIDATION_ISSUES } from '../config/constants';
import type { ErrorDetail } from './app-error';

// "12" -> 12 (query strings, csv cells). anything else goes to zod untouched
export function asNumber(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return value;
}

// z.enum wants a non-empty tuple, Object.values only gives back an array
export function enumValues<T extends Record<string, string>>(values: T) {
  return Object.values(values) as [T[keyof T], ...T[keyof T][]];
}

export function listIssues(zodError: ZodError): ErrorDetail[] {
  return zodError.issues.slice(0, MAX_VALIDATION_ISSUES).map((issue) => ({
    field: issue.path.join('.') || null,
    message: issue.message,
  }));
}

export function firstIssue(zodError: ZodError): string {
  const [issue] = zodError.issues;
  const field = issue.path.join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}
