import bulkUpdate from './bulk-update';
import type { ActionHandler } from './types';

// every action implements ActionHandler (see types.ts).
// planner, batches, retries, logs and stats are shared, so a new action is one file + one line here
const actions: Record<string, ActionHandler> = {
  [bulkUpdate.type]: bulkUpdate,
};

export const actionTypes = Object.keys(actions) as [string, ...string[]];

export function getAction(type: string): ActionHandler | undefined {
  return actions[type];
}

export type { ActionHandler, BatchRow, RowResult, RawRecord } from './types';
