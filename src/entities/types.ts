import type { ZodTypeAny } from 'zod';
import type { SqlType } from '../config/constants';

export interface EntityField {
  column: string;
  sqlType: SqlType;
  schema: ZodTypeAny;
}

// everything the shared code needs to know about an entity
export interface EntityConfig {
  type: string;
  label: string;
  table: string;
  idColumn: string;
  updatedAtColumn: string;
  // field used to spot duplicate records, null to turn it off
  dedupeField: string | null;
  // fields a bulk action is allowed to change
  fields: Record<string, EntityField>;
}
