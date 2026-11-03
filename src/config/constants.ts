// fixed values used across the app. anything you'd want to tune per environment lives in .env

export const BULK_ACTION_STATUS = {
  QUEUED: 'queued',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const ITEM_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;

export const SOURCE_TYPE = {
  JSON: 'json',
  CSV: 'csv',
  XLSX: 'xlsx',
} as const;

export type FileSourceType = typeof SOURCE_TYPE.CSV | typeof SOURCE_TYPE.XLSX;

export const ENTITY_TYPES = {
  CONTACT: 'contact',
} as const;

export const ACTION_TYPES = {
  BULK_UPDATE: 'bulk_update',
} as const;

export const CONTACT_STATUSES = ['lead', 'prospect', 'customer', 'inactive'] as const;

export const QUEUE_NAMES = {
  PLANNER: 'bulk-planner',
  BATCHES: 'bulk-batches',
} as const;

export const JOB_NAMES = {
  PLAN: 'plan-bulk-action',
  PROCESS_BATCH: 'process-batch',
} as const;

// bullmq doesn't allow ":" inside custom job ids
export const JOB_ID_SEPARATOR = '-';
export const FINAL_FAILED_STATE = 'failed';

export const ID_FIELD = 'id';

export const SQL_TYPES = {
  TEXT: 'text',
  INT: 'int',
} as const;

export type SqlType = (typeof SQL_TYPES)[keyof typeof SQL_TYPES];

export const FIELD_LIMITS = {
  ACCOUNT_ID_MAX: 64,
  NAME_MAX: 120,
  EMAIL_MAX: 254,
  AGE_MIN: 0,
  AGE_MAX: 150,
} as const;

export const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// upper bounds for the .env values so a typo can't take the db down
export const ENV_LIMITS = {
  MAX_PORT: 65535,
  MAX_JSON_RECORDS: 50000,
  MAX_PLANNER_CHUNK_SIZE: 10000,
  // postgres allows 65535 bind params per query, 5000 rows keeps us well under that
  MAX_BATCH_SIZE: 5000,
  MAX_CONCURRENCY: 50,
  // a file is meant to hold up to about a million records. a full contact row is
  // under 100 bytes, so 100MB covers that with room to spare (a 100k row test file is 5MB)
  MAX_UPLOAD_SIZE_MB: 100,
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  LOGS_DEFAULT_LIMIT: 50,
  LOGS_MAX_LIMIT: 500,
} as const;

export const UPLOAD = {
  FIELD_NAME: 'file',
  MAX_FILES: 1,
  MAX_FIELDS: 10,
} as const;

// file extension -> how the planner reads it
export const UPLOAD_TYPES: Readonly<Record<string, FileSourceType>> = {
  '.csv': SOURCE_TYPE.CSV,
  '.xlsx': SOURCE_TYPE.XLSX,
};

// every .xlsx is a zip file, and zip files start with these bytes
export const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

// the parts of an .xlsx zip we read, and the cell types that need converting
export const XLSX = {
  DIR: 'xl',
  WORKBOOK: 'xl/workbook.xml',
  WORKBOOK_RELS: 'xl/_rels/workbook.xml.rels',
  SHARED_STRINGS: 'xl/sharedStrings.xml',
  CELL_SHARED_STRING: 's',
  CELL_BOOLEAN: 'b',
} as const;

export const CSV_OPTIONS = {
  columns: true,
  bom: true,
  trim: true,
  skip_empty_lines: true,
  relax_column_count: true,
} as const;

export const RATE_LIMIT_PREFIX = {
  API: 'rl:api:',
  CREATE: 'rl:create:',
} as const;

export const ROUTES = {
  BULK_ACTIONS: '/bulk-actions',
} as const;

export const HTTP_STATUS = {
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// body-parser error types
export const BODY_ERRORS = {
  TOO_LARGE: 'entity.too.large',
  PARSE_FAILED: 'entity.parse.failed',
} as const;

export const MULTER_FILE_TOO_LARGE = 'LIMIT_FILE_SIZE';

// prisma / postgres errors caused by the data in a row, not by the db being unreachable
export const ROW_LEVEL_PRISMA_CODES: readonly string[] = ['P2000', 'P2002', 'P2003', 'P2004', 'P2011', 'P2020'];
export const RAW_QUERY_FAILED_CODE = 'P2010';
export const UNIQUE_VIOLATION_CODE = 'P2002';
// 22 = data exception, 23 = constraint violation
export const ROW_LEVEL_SQLSTATE_PREFIXES = ['22', '23'] as const;

export const BYTES_PER_MB = 1024 * 1024;
export const PERCENT_DECIMALS = 2;
export const FULL_PERCENT = 100;
export const MAX_VALIDATION_ISSUES = 20;

export const SEED = {
  DEFAULT_COUNT: 10000,
  CHUNK_SIZE: 5000,
  MIN_AGE: 18,
  MAX_AGE: 80,
} as const;

export const LOAD_TEST = {
  DEFAULT_ROWS: 10000,
  DUPLICATE_EMAIL_RATE: 0.01,
  INVALID_EMAIL_RATE: 0.005,
  POLL_INTERVAL_MS: 1000,
  ACCOUNT_ID: 'load_test',
  OUTPUT_DIR: 'tmp',
} as const;

export const MESSAGES = {
  VALIDATION_FAILED: 'Validation failed',
  ROUTE_NOT_FOUND: 'Route not found',
  BULK_ACTION_NOT_FOUND: 'Bulk action not found',
  RECORDS_OR_FILE_REQUIRED: 'Send either a records array or a file (.csv or .xlsx)',
  RECORDS_AND_FILE: 'Send either a records array or a file, not both',
  UNSUPPORTED_FILE: 'Only .csv and .xlsx files are allowed',
  NOT_AN_XLSX: 'File is not a valid .xlsx workbook',
  FILE_TOO_LARGE: 'File is too large',
  BODY_TOO_LARGE: 'Request body is too large',
  INVALID_JSON: 'Request body is not valid JSON',
  TOO_MANY_REQUESTS: 'Too many requests, please slow down',
  QUEUE_UNAVAILABLE: 'Could not queue the bulk action, please try again',
  SOMETHING_WENT_WRONG: 'Something went wrong',
  REQUIRED: 'is required',
  MUST_BE_NUMBER: 'must be a number',
  NOTHING_TO_UPDATE: 'nothing to update',
  CHUNK_NOT_MULTIPLE_OF_BATCH: 'must be a multiple of BATCH_SIZE',
  FILE_MISSING_COLUMNS: (columns: string[]) => `File is missing required column(s): ${columns.join(', ')}`,
  FILE_UNKNOWN_COLUMNS: (columns: string[], allowed: string[]) =>
    `File has unknown column(s): ${columns.join(', ')}. Allowed columns: ${allowed.join(', ')}`,
  NOT_FOUND: (label: string) => `${label} not found`,
  DUPLICATE_ENTITY: (label: string, row: number) => `duplicate ${label}, already in row ${row}`,
  DUPLICATE_FIELD: (field: string, row: number) => `duplicate ${field}, same as row ${row}`,
  GAVE_UP: (reason: string) => `gave up after retries: ${reason}`,
  UNSUPPORTED: (entityType: string, actionType: string) => `unsupported entity/action: ${entityType}/${actionType}`,
} as const;
