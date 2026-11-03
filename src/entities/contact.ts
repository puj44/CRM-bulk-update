import { z } from 'zod';
import { ENTITY_TYPES, CONTACT_STATUSES, FIELD_LIMITS, SQL_TYPES } from '../config/constants';
import { asNumber } from '../utils/validation';
import type { EntityConfig } from './types';

const contact: EntityConfig = {
  type: ENTITY_TYPES.CONTACT,
  label: 'contact',
  table: 'contacts',
  idColumn: 'id',
  updatedAtColumn: 'updated_at',
  // records with the same email inside one bulk action are treated as duplicates
  dedupeField: 'email',

  // fields a bulk action is allowed to change
  fields: {
    name: {
      column: 'name',
      sqlType: SQL_TYPES.TEXT,
      schema: z.string().trim().min(1).max(FIELD_LIMITS.NAME_MAX),
    },
    email: {
      column: 'email',
      sqlType: SQL_TYPES.TEXT,
      schema: z.string().trim().toLowerCase().email().max(FIELD_LIMITS.EMAIL_MAX),
    },
    age: {
      column: 'age',
      sqlType: SQL_TYPES.INT,
      schema: z.preprocess(asNumber, z.number().int().min(FIELD_LIMITS.AGE_MIN).max(FIELD_LIMITS.AGE_MAX)),
    },
    status: {
      column: 'status',
      sqlType: SQL_TYPES.TEXT,
      schema: z.enum(CONTACT_STATUSES),
    },
  },
};

export default contact;
