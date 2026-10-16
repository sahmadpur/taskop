import { AUDIT_LIMITS, type AuditResult, type AuditScore, type AuditVerdict, type ProblemSeverity } from '@taskop/contracts';
import { interpolate, type Language, translationsFor } from '@taskop/i18n';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatInstant } from '../../reports/export/report-table';
import { renderPdf } from '../../reports/pdf/pdf-document';

/** One item row, already printable: the loader (Task 15) turns the run into these. */
export interface ReportItem {
  itemId: string;
  label: string;
  /** Follow-up depth, for the indent. */
  depth: number;
  /** The current answer with its note. */
  answer: string;
  /** The original answer with its note when a correction changed it; null otherwise. */
  original: string | null;
  /** The latest correction of the item. */
  correctedBy: { name: string; reason: string } | null;
  verdict: AuditVerdict | null;
  verdictComment: string | null;
  /** The item's active rule or manual problem (the more severe one). */
  problem: { severity: ProblemSeverity; note: string | null } | null;
  /** data: URLs of the embedded photos (at most 3, see selectReportPhotos). */
  photos: string[];
  /** Photos counted, not embedded. */
  morePhotos: number;
  videos: number;
}

export interface ReportSection {
  title: string;
  items: ReportItem[];
}

export interface AuditReportData {
  auditId: string;
  tenantName: string;
  timezone: string;
  checklistName: string;
  versionNumber: number;
  siteName: string;
  executorName: string;
  localDate: string;
  window: { startsAt: Date; closesAt: Date };
  /** Device times (FR-10.14). */
  startedAt: Date;
  completedAt: Date | null;
  /** The server receipt of the completion. */
  syncedAt: Date | null;
  auditorName: string;
  finishedAt: Date;
  result: AuditResult;
  auditScore: AuditScore;
  runScore: number | null;
  /** The score before the first correction; null when never corrected. */
  originalScore: number | null;
  comment: string | null;
  sections: ReportSection[];
  generatedAt: Date;
  /** The auditor's language: every label of the PDF. */
  locale: Language;
}

/** Spec §7.2: up to 3 photos per item and 40 per report, in checklist order; the rest are counted, not embedded. */
export function selectReportPhotos(itemIds: readonly string[], photosByItem: ReadonlyMap<string, readonly string[]>): { embedded: Map<string, string[]>; skipped: Map<string, number> } {
  const embedded = new Map<string, string[]>();
  const skipped = new Map<string, number>();
  let left = AUDIT_LIMITS.photosPerReport;
  for (const id of itemIds) {
    const all = photosByItem.get(id) ?? [];
    const take = all.slice(0, Math.min(AUDIT_LIMITS.photosPerItem, left));
    left -= take.length;
    if (take.length) embedded.set(id, [...take]);
    if (all.length > take.length) skipped.set(id, all.length - take.length);
  }
  return { embedded, skipped };
}

/** A4 portrait: the header table, one table per section (item, answer, verdict), and a footer with time, id and page. */
export function auditReportDefinition(d: AuditReportData): TDocumentDefinitions {
  const T = translationsFor(d.locale);
  const L = T.audits.report;
  const percent = (v: number | null): string => (v === null ? L.none : `${v.toFixed(1)}%`);
  const at = (x: Date | null, tz: string): string => (x ? formatInstant(x, tz) : L.none);
  const tz = d.timezone;
  const images: Record<string, string> = {};
  const image = (dataUrl: string): string => {
    const key = `photo${Object.keys(images).length}`;
    images[key] = dataUrl;
    return key;
  };
  const runScore = d.originalScore !== null && d.originalScore !== d.runScore ? `${percent(d.runScore)} (${L.originalScore}: ${percent(d.originalScore)})` : percent(d.runScore);
  const header: [string, string][] = [
    [L.checklist, `${d.checklistName} · ${interpolate(L.version, { number: d.versionNumber })}`],
    [L.site, d.siteName],
    [L.executor, d.executorName],
    [L.window, `${formatInstant(d.window.startsAt, tz)} – ${formatInstant(d.window.closesAt, tz)}`],
    [L.startedAt, at(d.startedAt, tz)],
    [L.completedAt, at(d.completedAt, tz)],
    [L.syncedAt, at(d.syncedAt, tz)],
    [L.auditor, d.auditorName],
    [L.finishedAt, at(d.finishedAt, tz)],
    [L.result, T.audits.results[d.result]],
    [L.auditScore, `${percent(d.auditScore.percent)} (${d.auditScore.approved}/${d.auditScore.reviewed})`],
    [L.runScore, runScore],
    [L.comment, d.comment ?? L.none],
  ];
  const content: Content[] = [
    { text: d.tenantName, style: 'tenant' },
    { text: L.title, style: 'title' },
    { table: { widths: [130, '*'], body: header.map(([k, v]): TableCell[] => [{ text: k, bold: true }, { text: v }]) }, layout: 'noBorders' },
  ];
  for (const section of d.sections) {
    const body: TableCell[][] = [[L.item, L.answer, L.verdict].map((t): TableCell => ({ text: t, bold: true, fillColor: '#eeeeee' }))];
    for (const it of section.items) {
      const answer: Content[] = [{ text: it.answer }];
      if (it.original !== null) answer.push({ text: `${L.original}: ${it.original}`, style: 'muted' });
      if (it.correctedBy) answer.push({ text: interpolate(L.correctedBy, { name: it.correctedBy.name, reason: it.correctedBy.reason }), style: 'muted' });
      if (it.problem) answer.push({ text: `${L.problem}: ${T.executions.severities[it.problem.severity]}${it.problem.note ? ` — ${it.problem.note}` : ''}`, color: '#b42318' });
      // The same caps selectReportPhotos applies, so a caller that skips it cannot embed everything; the cut photos are counted.
      const shown = it.photos.slice(0, Math.min(AUDIT_LIMITS.photosPerItem, AUDIT_LIMITS.photosPerReport - Object.keys(images).length));
      if (shown.length) answer.push({ columns: shown.map((p): Content => ({ image: image(p), fit: [150, 150] })), columnGap: 6, margin: [0, 4, 0, 0] });
      const more = it.morePhotos + it.photos.length - shown.length;
      const extras = [more ? interpolate(L.morePhotos, { count: more }) : null, it.videos ? interpolate(L.videos, { count: it.videos }) : null].filter(Boolean);
      if (extras.length) answer.push({ text: extras.join(' · '), style: 'muted' });
      const verdict: Content[] = [{ text: it.verdict ? T.audits.verdicts[it.verdict] : T.audits.verdicts.unreviewed, bold: it.verdict === 'rejected' }];
      if (it.verdictComment) verdict.push({ text: it.verdictComment, style: 'muted' });
      body.push([{ text: it.label, margin: [it.depth * 10, 0, 0, 0] }, { stack: answer }, { stack: verdict }]);
    }
    content.push({ text: section.title, style: 'section' }, { table: { headerRows: 1, widths: ['30%', '45%', '25%'], body }, layout: 'lightHorizontalLines' });
  }
  return {
    pageSize: 'A4',
    pageMargins: [28, 28, 28, 40],
    info: { title: `${L.title} ${d.auditId}`, creator: 'Taskop' },
    defaultStyle: { font: 'NotoSans', fontSize: 9 },
    styles: {
      tenant: { fontSize: 14, bold: true },
      title: { fontSize: 12, margin: [0, 2, 0, 8] },
      section: { fontSize: 11, bold: true, margin: [0, 12, 0, 4] },
      muted: { color: '#666666', fontSize: 8 },
    },
    images,
    footer: (current, total) => ({
      columns: [
        { width: '*', text: `${L.generatedAt}: ${formatInstant(d.generatedAt, tz)} · ${L.auditId}: ${d.auditId}` },
        { width: 'auto', text: interpolate(L.page, { page: current, pages: total }), alignment: 'right' },
      ],
      margin: [28, 10, 28, 0],
      fontSize: 7,
      color: '#666666',
    }),
    content,
  };
}

export function buildAuditReport(d: AuditReportData): Promise<Buffer> {
  return renderPdf(auditReportDefinition(d));
}
