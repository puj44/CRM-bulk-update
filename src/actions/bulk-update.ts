import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { ACTION_TYPES, ID_FIELD, SQL_TYPES, MESSAGES } from '../config/constants';
import { asNumber, firstIssue } from '../utils/validation';
import type { EntityConfig } from '../entities/types';
import type { ActionHandler, BatchRow, ParsedRecord, RawRecord, RowResult } from './types';

const idSchema = z.preprocess(
  asNumber,
  z.number({ required_error: MESSAGES.REQUIRED, invalid_type_error: MESSAGES.MUST_BE_NUMBER }).int().positive(),
);

// built once per entity, not once per row
const recordSchemas = new Map<string, z.ZodTypeAny>();

function getRecordSchema(entity: EntityConfig): z.ZodTypeAny {
  let schema = recordSchemas.get(entity.type);
  if (!schema) {
    const shape: z.ZodRawShape = { [ID_FIELD]: idSchema };
    for (const [name, field] of Object.entries(entity.fields)) {
      shape[name] = field.schema.optional();
    }
    schema = z.object(shape).strict();
    recordSchemas.set(entity.type, schema);
  }
  return schema;
}

const requiredFields = [ID_FIELD];

function getAllowedFields(entity: EntityConfig): string[] {
  return [ID_FIELD, ...Object.keys(entity.fields)];
}

// checks one incoming record, gives back the entity id and the cleaned changes
function parseRecord(record: RawRecord, entity: EntityConfig): ParsedRecord {
  const id = idSchema.safeParse(record[ID_FIELD]);
  const entityId = id.success ? id.data : null;

  const result = getRecordSchema(entity).safeParse(record);
  if (!result.success) return { entityId, error: firstIssue(result.error) };

  const changes: Record<string, unknown> = { ...result.data };
  delete changes[ID_FIELD];

  if (Object.keys(changes).length === 0) return { entityId, error: MESSAGES.NOTHING_TO_UPDATE };
  // the full schema passed, so the id did too
  return { entityId: entityId as number, data: changes };
}

const quote = (name: string) => Prisma.raw(`"${name}"`);
const param = (value: unknown, sqlType: string) => Prisma.sql`${value ?? null}::${Prisma.raw(sqlType)}`;

// updates the whole batch with a single UPDATE ... FROM (VALUES ...) query.
// fields a row didn't send come through as null and keep their current value
async function applyBatch({
  tx,
  entity,
  rows,
}: {
  tx: Prisma.TransactionClient;
  entity: EntityConfig;
  rows: BatchRow[];
}): Promise<RowResult[]> {
  const fields = Object.entries(entity.fields);
  const id = quote(entity.idColumn);

  const values = rows.map((row) => {
    const rowValues = fields.map(([name, field]) => param(row.data[name], field.sqlType));
    return Prisma.sql`(${Prisma.join([param(row.entityId, SQL_TYPES.INT), ...rowValues])})`;
  });

  const columns = Prisma.join([id, ...fields.map(([, field]) => quote(field.column))]);
  const assignments = Prisma.join(
    fields.map(([, field]) => {
      const column = quote(field.column);
      return Prisma.sql`${column} = COALESCE(v.${column}, t.${column})`;
    }),
  );

  const updated = await tx.$queryRaw<{ id: number }[]>`
    UPDATE ${quote(entity.table)} AS t
    SET ${assignments}, ${quote(entity.updatedAtColumn)} = NOW()
    FROM (VALUES ${Prisma.join(values)}) AS v(${columns})
    WHERE t.${id} = v.${id}
    RETURNING t.${id} AS id
  `;

  const updatedIds = new Set(updated.map((row) => row.id));

  return rows.map((row) =>
    updatedIds.has(row.entityId)
      ? { rowNumber: row.rowNumber, ok: true }
      : { rowNumber: row.rowNumber, ok: false, message: MESSAGES.NOT_FOUND(entity.label) },
  );
}

const bulkUpdate: ActionHandler = {
  type: ACTION_TYPES.BULK_UPDATE,
  requiredFields,
  getAllowedFields,
  parseRecord,
  applyBatch,
};

export default bulkUpdate;
