// end to end load test: builds a csv or xlsx, uploads it, polls stats until done, prints throughput.
// needs the api + at least one worker running, and contacts seeded first:
//   npm run db:seed -- 100000
//   npm run load-test -- 100000          (csv)
//   npm run load-test -- 100000 xlsx

import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import env from '../src/config/env';
import {
  LOAD_TEST,
  CONTACT_STATUSES,
  ENTITY_TYPES,
  ACTION_TYPES,
  ROUTES,
  UPLOAD,
  BULK_ACTION_STATUS,
  SOURCE_TYPE,
} from '../src/config/constants';

interface Stats {
  id: string;
  status: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  percent: number;
}

const rowCount = Number(process.argv[2]) || LOAD_TEST.DEFAULT_ROWS;
const format = process.argv[3] === SOURCE_TYPE.XLSX ? SOURCE_TYPE.XLSX : SOURCE_TYPE.CSV;
const baseUrl = `http://localhost:${env.port}${ROUTES.BULK_ACTIONS}`;

const header = ['id', 'name', 'email', 'status'];

// sprinkle in some duplicates and bad values so skipped / failed show up too
function makeRow(id: number): [number, string, string, string] {
  let email = `user${id}@loadtest.dev`;
  if (id > 1 && Math.random() < LOAD_TEST.DUPLICATE_EMAIL_RATE) email = `user${id - 1}@loadtest.dev`;
  if (Math.random() < LOAD_TEST.INVALID_EMAIL_RATE) email = 'not-an-email';

  return [id, `Load User ${id}`, email, CONTACT_STATUSES[id % CONTACT_STATUSES.length]];
}

function buildCsv(filePath: string): Promise<void> {
  const out = fs.createWriteStream(filePath);
  out.write(`${header.join(',')}\n`);

  for (let id = 1; id <= rowCount; id += 1) {
    out.write(`${makeRow(id).join(',')}\n`);
  }

  return new Promise((resolve, reject) => {
    out.end(resolve);
    out.on('error', reject);
  });
}

// streaming writer, so building a big workbook doesn't need it all in memory
async function buildXlsx(filePath: string): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath });
  const sheet = workbook.addWorksheet('contacts');
  sheet.addRow(header).commit();

  for (let id = 1; id <= rowCount; id += 1) {
    sheet.addRow(makeRow(id)).commit();
  }

  sheet.commit();
  await workbook.commit();
}

async function upload(filePath: string): Promise<string> {
  const form = new FormData();
  form.append('accountId', LOAD_TEST.ACCOUNT_ID);
  form.append('entityType', ENTITY_TYPES.CONTACT);
  form.append('actionType', ACTION_TYPES.BULK_UPDATE);
  form.append(UPLOAD.FIELD_NAME, await fs.openAsBlob(filePath), path.basename(filePath));

  const res = await fetch(baseUrl, { method: 'POST', body: form });
  const body = (await res.json()) as { data: { id: string } };
  if (!res.ok) throw new Error(`upload failed (${res.status}): ${JSON.stringify(body)}`);
  return body.data.id;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntilDone(id: string): Promise<Stats> {
  for (;;) {
    const res = await fetch(`${baseUrl}/${id}/stats`);
    const { data } = (await res.json()) as { data: Stats };

    process.stdout.write(
      `\r${data.status} ${data.percent}%  success ${data.success}  failed ${data.failed}  skipped ${data.skipped}   `,
    );

    if (data.status === BULK_ACTION_STATUS.COMPLETED || data.status === BULK_ACTION_STATUS.FAILED) {
      process.stdout.write('\n');
      return data;
    }
    await sleep(LOAD_TEST.POLL_INTERVAL_MS);
  }
}

async function main() {
  fs.mkdirSync(LOAD_TEST.OUTPUT_DIR, { recursive: true });
  const filePath = path.join(LOAD_TEST.OUTPUT_DIR, `load-test-${rowCount}.${format}`);

  console.log(`building ${format} with ${rowCount} rows...`);
  await (format === SOURCE_TYPE.XLSX ? buildXlsx(filePath) : buildCsv(filePath));

  const startedAt = Date.now();
  const id = await upload(filePath);
  console.log(`bulk action ${id} created, waiting for it to finish`);

  const stats = await waitUntilDone(id);
  const seconds = (Date.now() - startedAt) / 1000;

  console.log(`done in ${seconds.toFixed(1)}s`);
  console.log(`throughput: ${Math.round((stats.total / seconds) * 60)} records/min`);
  console.log(stats);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
