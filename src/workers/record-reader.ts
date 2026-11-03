import fs from 'fs';
import { parse } from 'csv-parse';
import type { BulkAction } from '@prisma/client';
import { SOURCE_TYPE, CSV_OPTIONS } from '../config/constants';
import { readXlsxRows } from '../utils/xlsx';
import type { RawRecord } from '../actions';

export interface NumberedRecord {
  rowNumber: number;
  record: RawRecord;
}

function* readJsonRecords(records: RawRecord[] | null): Generator<RawRecord> {
  yield* records ?? [];
}

// empty csv cell = "don't touch this field"
function dropEmptyValues(row: Record<string, string>): RawRecord {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== ''));
}

async function* readCsvRecords(filePath: string): AsyncGenerator<RawRecord> {
  const input = fs.createReadStream(filePath);
  const parser = parse(CSV_OPTIONS);

  // pipe() doesn't forward read errors, without this a missing file would hang forever
  input.on('error', (err) => parser.destroy(err));
  input.pipe(parser);

  for await (const row of parser) {
    yield dropEmptyValues(row as Record<string, string>);
  }
}

// first row is the header, same as a csv. cells are already plain text, so after
// this an xlsx record is no different from a csv one
async function* readXlsxRecords(filePath: string): AsyncGenerator<RawRecord> {
  let header: string[] | null = null;

  for await (const cells of readXlsxRows(filePath)) {
    if (!header) {
      header = cells;
      continue;
    }

    // columns with a blank header and cells past the last header are ignored, like the csv reader does
    const row: Record<string, string> = {};
    header.forEach((column, i) => {
      if (column) row[column] = cells[i] ?? '';
    });

    const record = dropEmptyValues(row);
    if (Object.keys(record).length) yield record;
  }
}

function recordsOf(action: Pick<BulkAction, 'sourceType' | 'filePath' | 'records'>) {
  switch (action.sourceType) {
    case SOURCE_TYPE.CSV:
      return readCsvRecords(action.filePath as string);
    case SOURCE_TYPE.XLSX:
      return readXlsxRecords(action.filePath as string);
    default:
      return readJsonRecords(action.records as RawRecord[] | null);
  }
}

// yields [{ rowNumber, record }] chunks. the file stream is paused while a chunk
// is being handled, so memory stays at one chunk no matter how big the file is
export async function* readRecordsInChunks(
  action: Pick<BulkAction, 'sourceType' | 'filePath' | 'records'>,
  chunkSize: number,
): AsyncGenerator<NumberedRecord[]> {
  const source = recordsOf(action);

  let chunk: NumberedRecord[] = [];
  let rowNumber = 0;

  for await (const record of source) {
    rowNumber += 1;
    chunk.push({ rowNumber, record });

    if (chunk.length === chunkSize) {
      yield chunk;
      chunk = [];
    }
  }

  if (chunk.length) yield chunk;
}
