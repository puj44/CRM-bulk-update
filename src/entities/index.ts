import contact from './contact';
import type { EntityConfig } from './types';

// to support a new entity: add its prisma model, write a config like contact.ts, register it here
const entities: Record<string, EntityConfig> = {
  [contact.type]: contact,
};

export const entityTypes = Object.keys(entities) as [string, ...string[]];

export function getEntity(type: string): EntityConfig | undefined {
  return entities[type];
}

export type { EntityConfig, EntityField } from './types';
