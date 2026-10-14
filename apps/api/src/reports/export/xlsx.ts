import { az } from '@taskop/i18n';
import writeXlsxFile, { type Cell, type Row, type Sheet } from 'write-excel-file/node';
import { type CellValue, type ReportColumn, type ReportDocument, wallClock } from './report-table';

const FORBIDDEN = /[\\/?*[\]:]/g;
const MAX_NAME = 31;

/** An Excel-valid sheet name (at most 31 characters, none of \ / ? * [ ] :), unique within `used`. */
export function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(FORBIDDEN, ' ').trim().slice(0, MAX_NAME) || 'Sheet';
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base.slice(0, MAX_NAME - 3)} ${i}`;
  used.add(name);
  return name;
}

/** Typed cells, so people can sort and sum (spec §5.4). Dates hold the tenant's wall clock (Spec decision 21). */
function xlsxCell(col: ReportColumn, v: CellValue, tz: string): Cell {
  if (v === null) return null;
  switch (col.type) {
    case 'text':
      return { type: String, value: String(v) };
    case 'int':
      return { type: Number, value: v as number, format: '0' };
    case 'decimal':
      return { type: Number, value: v as number, format: '0.0' };
    case 'number':
      return { type: Number, value: v as number };
    case 'date': {
      const [y, m, d] = (v as string).split('-').map(Number) as [number, number, number];
      return { type: Date, value: new Date(Date.UTC(y, m - 1, d)), format: 'dd.mm.yyyy' };
    }
    case 'datetime':
      return { type: Date, value: wallClock(v as string, tz), format: 'dd.mm.yyyy hh:mm' };
    case 'bool':
      return { type: String, value: v ? az.reports.yes : az.reports.no };
  }
}

const widthOf = (c: ReportColumn): number => c.width ?? (c.type === 'datetime' ? 17 : c.type === 'text' ? 18 : 12);

/** One sheet per section, a bold frozen header row (spec §5.4). */
export function toXlsx(doc: ReportDocument): Promise<Buffer> {
  const used = new Set<string>();
  const sheets: Sheet<Buffer>[] = doc.sections.map((t) => ({
    sheet: sheetName(t.title, used),
    data: [
      t.columns.map((c): Cell => ({ type: String, value: c.label, fontWeight: 'bold' })),
      ...t.rows.map((r): Row => r.map((v, i) => xlsxCell(t.columns[i]!, v, doc.timezone))),
    ],
    columns: t.columns.map((c) => ({ width: widthOf(c) })),
    stickyRowsCount: 1,
  }));
  return writeXlsxFile(sheets).toBuffer();
}
