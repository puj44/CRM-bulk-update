import path from 'path';
import type { Readable } from 'stream';
import unzipper from 'unzipper';
import { SaxesParser } from 'saxes';
import { XLSX } from '../config/constants';

// an .xlsx is a zip of xml files. this reads just what we need: which sheet comes first,
// the shared strings table, and that sheet's rows, one at a time.
// (exceljs's streaming reader failed now and then when xl/workbook.xml came last in the zip,
// so files are opened through the zip's directory instead, in any order.)

interface XmlHandlers {
  open?(name: string, attrs: Record<string, string>): void;
  close?(name: string): void;
  text?(text: string): void;
}

// some tools write prefixed tags (x:row), the prefix doesn't matter here
const localName = (name: string) => name.slice(name.indexOf(':') + 1);

function xmlParser(handlers: XmlHandlers): SaxesParser {
  const parser = new SaxesParser();
  parser.on('opentag', (tag) => handlers.open?.(localName(tag.name), tag.attributes as Record<string, string>));
  parser.on('closetag', (tag) => handlers.close?.(localName(tag.name)));
  parser.on('text', (text) => handlers.text?.(text));
  parser.on('cdata', (text) => handlers.text?.(text));
  return parser;
}

function findEntry(directory: unzipper.CentralDirectory, name: string) {
  const file = directory.files.find((entry) => entry.path === name);
  if (!file) throw new Error(`${name} missing`);
  return file;
}

// parses a whole zip entry, handlers collect what they need along the way
async function parseEntry(input: Readable, handlers: XmlHandlers): Promise<void> {
  const parser = xmlParser(handlers);
  input.setEncoding('utf8');
  for await (const chunk of input) parser.write(chunk as string);
  parser.close();
}

// same, but hands back whatever rows are ready after each chunk, so a big sheet never sits in memory
async function* parseEntryRows(input: Readable, handlers: XmlHandlers, take: () => string[][]) {
  const parser = xmlParser(handlers);
  input.setEncoding('utf8');
  try {
    for await (const chunk of input) {
      parser.write(chunk as string);
      yield* take();
    }
    parser.close();
    yield* take();
  } finally {
    input.destroy();
  }
}

// the first tab in excel, which isn't always sheet1.xml
async function firstSheetPath(directory: unzipper.CentralDirectory): Promise<string> {
  let relId: string | undefined;
  await parseEntry(findEntry(directory, XLSX.WORKBOOK).stream(), {
    open(name, attrs) {
      if (name !== 'sheet' || relId) return;
      const key = Object.keys(attrs).find((attr) => attr !== 'sheetId' && localName(attr) === 'id');
      relId = key && attrs[key];
    },
  });

  let target: string | undefined;
  await parseEntry(findEntry(directory, XLSX.WORKBOOK_RELS).stream(), {
    open(name, attrs) {
      if (name === 'Relationship' && attrs.Id === relId) target = attrs.Target;
    },
  });
  if (!target) throw new Error('workbook has no sheets');

  // targets are relative to xl/, or absolute from the zip root
  return target.startsWith('/') ? target.slice(1) : path.posix.join(XLSX.DIR, target);
}

// text cells point into this table. it has to be held in memory, that's how the format works
async function readSharedStrings(directory: unzipper.CentralDirectory): Promise<string[]> {
  const file = directory.files.find((entry) => entry.path === XLSX.SHARED_STRINGS);
  if (!file) return [];

  const strings: string[] = [];
  let current = '';
  let inText = false;
  let inPhonetic = false; // furigana hints, not part of the text

  const handlers: XmlHandlers = {
    open(name) {
      if (name === 'si') current = '';
      if (name === 'rPh') inPhonetic = true;
      if (name === 't' && !inPhonetic) inText = true;
    },
    close(name) {
      if (name === 't') inText = false;
      if (name === 'rPh') inPhonetic = false;
      if (name === 'si') strings.push(current);
    },
    text(text) {
      if (inText) current += text;
    },
  };
  await parseEntry(file.stream(), handlers);
  return strings;
}

// "C12" -> 2
function columnIndex(ref: string): number {
  let index = 0;
  for (const char of ref) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

// every cell becomes plain trimmed text, so an xlsx row looks exactly like a csv row
function cellValue(type: string, raw: string, strings: string[]): string {
  if (type === XLSX.CELL_SHARED_STRING) return (strings[Number(raw)] ?? '').trim();
  if (type === XLSX.CELL_BOOLEAN) return raw === '1' ? 'TRUE' : 'FALSE';
  return raw.trim();
}

// rows of the first sheet, one at a time, as plain text. rows with nothing in them are skipped
export async function* readXlsxRows(filePath: string): AsyncGenerator<string[]> {
  const directory = await unzipper.Open.file(filePath);
  const sheet = findEntry(directory, await firstSheetPath(directory));
  const strings = await readSharedStrings(directory);

  const ready: string[][] = [];
  let cells: string[] = [];
  let nextColumn = 0;
  let cell = { column: 0, type: '', raw: '' };
  let capture = false;
  let inPhonetic = false;

  const handlers: XmlHandlers = {
    open(name, attrs) {
      if (name === 'row') {
        cells = [];
        nextColumn = 0;
      } else if (name === 'c') {
        // r="B2" is optional, without it the cell is just the next one along
        cell = { column: attrs.r ? columnIndex(attrs.r) : nextColumn, type: attrs.t ?? '', raw: '' };
      } else if (name === 'rPh') {
        inPhonetic = true;
      } else if ((name === 'v' || name === 't') && !inPhonetic) {
        // <v> holds the value (or a formula's result), <is><t> holds inline text
        capture = true;
      }
    },
    close(name) {
      if (name === 'v' || name === 't') capture = false;
      else if (name === 'rPh') inPhonetic = false;
      else if (name === 'c') {
        cells[cell.column] = cellValue(cell.type, cell.raw, strings);
        nextColumn = cell.column + 1;
      } else if (name === 'row') {
        const row = Array.from(cells, (value) => value ?? '');
        if (row.some(Boolean)) ready.push(row);
      }
    },
    text(text) {
      if (capture) cell.raw += text;
    },
  };

  yield* parseEntryRows(sheet.stream(), handlers, () => ready.splice(0));
}
