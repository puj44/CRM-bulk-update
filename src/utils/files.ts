import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { parse } from 'csv-parse/sync';
import { readXlsxRows } from './xlsx';
import { SOURCE_TYPE, UPLOAD_TYPES, ZIP_SIGNATURE, type FileSourceType } from '../config/constants';

export async function removeFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

// undefined for anything we can't read
export function uploadTypeOf(fileName: string): FileSourceType | undefined {
  return UPLOAD_TYPES[path.extname(fileName).toLowerCase()];
}

// the extension is only a name, this checks the file really is a zip (which every .xlsx is)
export async function isZipFile(filePath: string): Promise<boolean> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const start = Buffer.alloc(ZIP_SIGNATURE.length);
    await handle.read(start, 0, start.length, 0);
    return start.equals(ZIP_SIGNATURE);
  } finally {
    await handle.close();
  }
}

async function readFirstLine(filePath: string): Promise<string> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of lines) return line;
    return '';
  } finally {
    lines.close();
    stream.destroy();
  }
}

async function readCsvHeader(filePath: string): Promise<string[]> {
  const line = await readFirstLine(filePath);
  if (!line.trim()) return [];

  const [header = []] = parse(line, { bom: true, trim: true }) as string[][];
  return header;
}

// blank header cells are just stray formatting in excel, they don't count as columns
async function readXlsxHeader(filePath: string): Promise<string[]> {
  for await (const row of readXlsxRows(filePath)) return row.filter(Boolean);
  return [];
}

// only reads the header row, so it's cheap even for a huge file
export function readFileHeader(filePath: string, type: FileSourceType): Promise<string[]> {
  return type === SOURCE_TYPE.XLSX ? readXlsxHeader(filePath) : readCsvHeader(filePath);
}
