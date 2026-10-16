import { tzOffsetMinutes } from '@taskop/contracts';
import { type Language, translationsFor } from '@taskop/i18n';

/** How a column is typed in Excel and printed in CSV and PDF. */
export type ColumnType = 'text' | 'int' | 'decimal' | 'number' | 'date' | 'datetime' | 'bool';

export interface ReportColumn {
  label: string;
  type: ColumnType;
  /** Excel column width in characters. */
  width?: number;
}

/** text → string; int / decimal / number → number; date → 'YYYY-MM-DD'; datetime → ISO instant; bool → boolean; null = empty. */
export type CellValue = string | number | boolean | null;

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: CellValue[][];
}

/** One export: the PDF header fields and its sections (one sheet each in Excel). */
export interface ReportDocument {
  title: string;
  tenantName: string;
  from: string;
  to: string;
  /** "Obyekt: Zona A1"-style lines; empty without filters. */
  filters: string[];
  generatedAt: Date;
  timezone: string;
  /** The requesting user's language: titles, headers, enum cells and the PDF's fixed texts. */
  locale: Language;
  sections: ReportTable[];
}

/** 'YYYY-MM-DD' → 'DD.MM.YYYY'. */
export const formatDate = (d: string): string => d.split('-').reverse().join('.');

/** The tenant's wall-clock reading of an instant, as a Date whose UTC fields hold it (Excel dates have no zone). */
export function wallClock(instant: string | Date, tz: string): Date {
  const ms = +new Date(instant);
  return new Date(ms + tzOffsetMinutes(tz, ms) * 60_000);
}

/** 'DD.MM.YYYY HH:mm' on the tenant's wall clock (Spec decision 21). */
export function formatInstant(instant: string | Date, tz: string): string {
  const w = wallClock(instant, tz).toISOString();
  return `${formatDate(w.slice(0, 10))} ${w.slice(11, 16)}`;
}

/** A cell as CSV and PDF print it; null is empty. */
export function cellText(col: ReportColumn, v: CellValue, tz: string, locale: Language): string {
  if (v === null) return '';
  switch (col.type) {
    case 'text':
    case 'int':
    case 'number':
      return String(v);
    case 'decimal':
      return (v as number).toFixed(1);
    case 'date':
      return formatDate(v as string);
    case 'datetime':
      return formatInstant(v as string, tz);
    case 'bool':
      return v ? translationsFor(locale).reports.yes : translationsFor(locale).reports.no;
  }
}
