import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import env from '../config/env';
import AppError from '../utils/app-error';
import { uploadTypeOf } from '../utils/files';
import { HTTP_STATUS, MESSAGES, UPLOAD } from '../config/constants';

fs.mkdirSync(env.upload.dir, { recursive: true });

// streams straight to disk, the file is never held in memory.
// keeps the extension, that's how the planner knows how to read it
const storage = multer.diskStorage({
  destination: env.upload.dir,
  filename: (req, file, done) =>
    done(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});

const onlySupportedFiles: multer.Options['fileFilter'] = (req, file, done) => {
  if (!uploadTypeOf(file.originalname)) return done(new AppError(HTTP_STATUS.BAD_REQUEST, MESSAGES.UNSUPPORTED_FILE));
  done(null, true);
};

// no-op for json requests, multer only kicks in for multipart/form-data
const uploadFile = multer({
  storage,
  fileFilter: onlySupportedFiles,
  limits: { fileSize: env.upload.maxFileSize, files: UPLOAD.MAX_FILES, fields: UPLOAD.MAX_FIELDS },
}).single(UPLOAD.FIELD_NAME);

export default uploadFile;
