import { Router } from 'express';
import * as controller from './bulk-actions.controller';
import validate from '../../middlewares/validate';
import uploadFile from '../../middlewares/upload';
import { createLimiter } from '../../middlewares/rate-limit';
import {
  createBulkActionSchema,
  listBulkActionsSchema,
  bulkActionIdSchema,
  logsQuerySchema,
} from './bulk-actions.validation';

const router = Router();

router.get('/', validate(listBulkActionsSchema, 'query'), controller.listBulkActions);

// accepts a json body with records, or multipart/form-data with a .csv or .xlsx "file"
router.post('/', createLimiter, uploadFile, validate(createBulkActionSchema), controller.createBulkAction);

router.get('/:id', validate(bulkActionIdSchema, 'params'), controller.getBulkAction);

router.get('/:id/stats', validate(bulkActionIdSchema, 'params'), controller.getBulkActionStats);

router.get(
  '/:id/logs',
  validate(bulkActionIdSchema, 'params'),
  validate(logsQuerySchema, 'query'),
  controller.getBulkActionLogs,
);

export default router;
