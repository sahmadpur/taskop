import path from 'node:path';
import { az } from '@taskop/i18n';
import pdfmake from 'pdfmake';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { cellText, formatDate, formatInstant, type ReportDocument, type ReportTable } from '../export/report-table';

/** Noto Sans regular and bold (SIL OFL 1.1, see fonts/OFL.txt); `pnpm build` copies them next to the compiled file. */
export const FONTS_DIR = path.join(__dirname, 'fonts');
const REGULAR = path.join(FONTS_DIR, 'NotoSans-Regular.ttf');
const BOLD = path.join(FONTS_DIR, 'NotoSans-Bold.ttf');

// Every variant maps to a file, so a style can never ask for a missing font.
pdfmake.setFonts({ NotoSans: { normal: REGULAR, bold: BOLD, italics: REGULAR, bolditalics: BOLD } });
// Documents are built from our own data: no URL is ever fetched and only the two font files are read.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((p) => p === REGULAR || p === BOLD);

const L = az.reports.pdf;

function section(t: ReportTable, tz: string): Content[] {
  if (!t.rows.length) return [{ text: t.title, style: 'section' }, { text: L.empty, style: 'muted' }];
  const header: TableCell[] = t.columns.map((c) => ({ text: c.label, bold: true, fillColor: '#eeeeee' }));
  const body: TableCell[][] = t.rows.map((r) =>
    r.map((v, i) => {
      const col = t.columns[i]!;
      return { text: cellText(col, v, tz) || az.reports.noValue, alignment: col.type === 'text' ? 'left' : 'right' };
    }),
  );
  return [
    { text: t.title, style: 'section' },
    { table: { headerRows: 1, widths: t.columns.map(() => '*'), body: [header, ...body] }, layout: 'lightHorizontalLines', fontSize: t.columns.length > 10 ? 6.5 : 8 },
  ];
}

/** A4 landscape; header: tenant, title, period, filters, generation time (spec §5.4); one heading per section. */
export function pdfDefinition(doc: ReportDocument): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 28, 28, 36],
    info: { title: `${doc.title} ${doc.from}_${doc.to}`, creator: 'Taskop' },
    defaultStyle: { font: 'NotoSans', fontSize: 8 },
    styles: {
      tenant: { fontSize: 14, bold: true },
      title: { fontSize: 11, margin: [0, 2, 0, 6] },
      section: { fontSize: 11, bold: true, margin: [0, 12, 0, 4] },
      muted: { color: '#666666' },
    },
    footer: (current, total) => ({
      text: L.page.replace('{{page}}', String(current)).replace('{{pages}}', String(total)),
      alignment: 'right',
      margin: [28, 8, 28, 0],
      fontSize: 7,
      color: '#666666',
    }),
    content: [
      { text: doc.tenantName, style: 'tenant' },
      { text: doc.title, style: 'title' },
      { text: `${L.period}: ${formatDate(doc.from)} – ${formatDate(doc.to)}` },
      { text: `${L.filters}: ${doc.filters.length ? doc.filters.join('; ') : L.noFilters}` },
      { text: `${L.generatedAt}: ${formatInstant(doc.generatedAt, doc.timezone)}`, style: 'muted' },
      ...doc.sections.flatMap((s) => section(s, doc.timezone)),
    ],
  };
}

/** Renders any definition with the Noto Sans fonts and the access policies above; SP8's audit report uses it too. */
export function renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
  return pdfmake.createPdf(definition).getBuffer();
}

export function toPdf(doc: ReportDocument): Promise<Buffer> {
  return renderPdf(pdfDefinition(doc));
}
