import type { Request, Response } from 'express';
import * as bulkActionService from './bulk-actions.service';
import { HTTP_STATUS } from '../../config/constants';
import type {
  BulkActionIdParams,
  CreateBulkActionInput,
  ListBulkActionsQuery,
  LogsQuery,
} from './bulk-actions.validation';

// express 5 forwards rejected promises to the error handler, no try/catch needed here.
// each route runs validate() first, so req.validated holds the parsed values

export async function createBulkAction(req: Request, res: Response) {
  const action = await bulkActionService.createBulkAction(req.validated.body as CreateBulkActionInput, req.file);
  res.status(HTTP_STATUS.ACCEPTED).json({ data: action });
}

export async function listBulkActions(req: Request, res: Response) {
  const result = await bulkActionService.listBulkActions(req.validated.query as ListBulkActionsQuery);
  res.status(HTTP_STATUS.OK).json(result);
}

export async function getBulkAction(req: Request, res: Response) {
  const { id } = req.validated.params as BulkActionIdParams;
  const action = await bulkActionService.getBulkAction(id);
  res.status(HTTP_STATUS.OK).json({ data: action });
}

export async function getBulkActionStats(req: Request, res: Response) {
  const { id } = req.validated.params as BulkActionIdParams;
  const stats = await bulkActionService.getBulkActionStats(id);
  res.status(HTTP_STATUS.OK).json({ data: stats });
}

export async function getBulkActionLogs(req: Request, res: Response) {
  const { id } = req.validated.params as BulkActionIdParams;
  const logs = await bulkActionService.getBulkActionLogs(id, req.validated.query as LogsQuery);
  res.status(HTTP_STATUS.OK).json(logs);
}
