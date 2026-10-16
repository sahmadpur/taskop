import type { Language } from '@taskop/i18n';
import { cellText, type ReportDocument, type ReportTable } from './report-table';

const BOM = '\uFEFF';
/** OWASP's CSV-injection triggers: the spec's =, +, -, @ plus a leading tab or CR (Spec decision 19). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Prefixes text a spreadsheet would run as a formula with an apostrophe. */
export const neutralise = (s: string): string => (FORMULA_START.test(s) ? `'${s}` : s);

/** RFC 4180: quote a field with a comma, quote, CR or LF; double the quotes inside. */
export const csvField = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

function block(t: ReportTable, tz: string, locale: Language): string {
  const header = t.columns.map((c) => csvField(neutralise(c.label))).join(',');
  const rows = t.rows.map((r) =>
    r
      .map((v, i) => {
        const col = t.columns[i]!;
        const s = cellText(col, v, tz, locale);
        // Only text can be a formula; numbers, dates and booleans are written as they are.
        return csvField(col.type === 'text' ? neutralise(s) : s);
      })
      .join(','),
  );
  return [header, ...rows].join('\r\n');
}

/** UTF-8 with a BOM (Excel then reads Azerbaijani letters), comma-separated, CRLF; sections separated by an empty line (Spec decision 17). */
export function toCsv(doc: ReportDocument): Buffer {
  return Buffer.from(`${BOM}${doc.sections.map((t) => block(t, doc.timezone, doc.locale)).join('\r\n\r\n')}\r\n`, 'utf8');
}
