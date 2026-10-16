import { Injectable, Logger } from '@nestjs/common';
import { type Answers, answersEqual, type AuditResult, type AuditScore, type ScoreResult, visibleItems } from '@taskop/contracts';
import { type Language, pickLanguage } from '@taskop/i18n';
import { and, asc, eq, isNull } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { sanitiseForLog } from '../../common/error.filter';
import { tenantLanguage } from '../../common/locale';
import { DbService } from '../../db/db.service';
import { auditItemVerdicts, audits, checklists, checklistVersions, executionCorrections, executionMedia, executionProblems, executions, occurrences, sites, tenants, users } from '../../db/schema';
import { ExecutionLookups } from '../../executions/execution-lookups';
import { S3Service } from '../../storage/s3.service';
import { answerLine } from './answer-text';
import { type AuditReportData, type ReportItem, selectReportPhotos } from './audit-report-builder';

export interface ReportMailInfo {
  checklistName: string;
  siteName: string;
  localDate: string;
  result: AuditResult;
  auditorName: string;
  /** The auditor's language (the tenant's for a platform admin). */
  locale: Language;
}

interface Media {
  id: string;
  kind: 'photo' | 'video';
  status: 'pending' | 'uploaded';
  storageKey: string;
}

/** At most this many photos are fetched from storage at once: 40 photos of 1.5 MB must not be held in flight together. */
export const PHOTO_FETCH_CONCURRENCY = 4;

/**
 * A `data:` URL for a PNG or JPEG, or null for anything pdfmake would fail to embed (which would fail the whole report).
 * The magic bytes come first; then pdfkit, which pdfmake embeds with, opens the image in a throwaway document: that
 * rejects a PNG or JPEG signature followed by garbage or cut short. It parses the headers and does not decode the pixels.
 */
export function imageDataUrl(body: Buffer): string | null {
  const png = body.length > 4 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
  const jpeg = body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (!png && !jpeg) return null;
  try {
    // openImage is public in pdfkit but missing from @types/pdfkit.
    (new PDFDocument() as unknown as { openImage(src: Buffer): unknown }).openImage(body);
  } catch {
    return null;
  }
  return `data:${png ? 'image/png' : 'image/jpeg'};base64,${body.toString('base64')}`;
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep the order of `items`. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Spec §7.2 step 1: the audit, the run, the version, the corrections and the media, read for the PDF and the e-mail. */
@Injectable()
export class AuditReportLoader {
  private readonly logger = new Logger('AuditReportLoader');

  constructor(
    private readonly db: DbService,
    private readonly lookups: ExecutionLookups,
    private readonly s3: S3Service,
  ) {}

  async mailInfo(tenantId: string, auditId: string): Promise<ReportMailInfo | null> {
    return this.db.withTenant(tenantId, null, async (tx) => {
      const [r] = await tx
        .select({ checklistName: checklists.name, siteName: sites.name, localDate: occurrences.localDate, result: audits.result, auditorName: users.fullName, auditorLocale: users.locale })
        .from(audits)
        .innerJoin(occurrences, eq(occurrences.id, audits.occurrenceId))
        .innerJoin(checklists, eq(checklists.id, occurrences.checklistId))
        .innerJoin(sites, eq(sites.id, occurrences.siteId))
        .leftJoin(users, eq(users.id, audits.auditorUserId))
        .where(eq(audits.id, auditId));
      if (!r?.result) return null;
      // The auditor's language, the tenant's for a platform admin or a deleted auditor; the PDF uses the same (load()).
      const locale = pickLanguage(r.auditorLocale, await tenantLanguage(tx));
      return { checklistName: r.checklistName, siteName: r.siteName, localDate: r.localDate, result: r.result, auditorName: r.auditorName ?? 'Taskop', locale };
    });
  }

  /** Rows in one tenant transaction; the photo bytes are fetched afterwards, outside it. Null for a missing or unfinished audit. */
  async load(tenantId: string, auditId: string): Promise<AuditReportData | null> {
    const plan = await this.db.withTenant(tenantId, null, async (tx) => {
      const [a] = await tx
        .select({ audit: audits, auditorName: users.fullName, auditorLocale: users.locale })
        .from(audits)
        .leftJoin(users, eq(users.id, audits.auditorUserId))
        .where(eq(audits.id, auditId));
      if (!a || a.audit.status !== 'finished' || !a.audit.finishedAt || !a.audit.result) return null;
      const [x] = await tx
        .select({ e: executions, o: occurrences, executorName: users.fullName, checklistName: checklists.name, siteName: sites.name, versionNumber: checklistVersions.number })
        .from(executions)
        .innerJoin(occurrences, eq(occurrences.id, executions.occurrenceId))
        .innerJoin(users, eq(users.id, executions.executorUserId))
        .innerJoin(checklists, eq(checklists.id, occurrences.checklistId))
        .innerJoin(sites, eq(sites.id, occurrences.siteId))
        .innerJoin(checklistVersions, eq(checklistVersions.id, executions.checklistVersionId))
        .where(eq(executions.id, a.audit.executionId));
      const [tenant] = await tx.select({ name: tenants.name, timezone: tenants.timezone, locale: tenants.locale }).from(tenants);
      // The auditor's language, the tenant's for a platform admin or a deleted auditor (same rule as mailInfo).
      const locale = pickLanguage(a.auditorLocale, tenant?.locale);
      const content = await this.lookups.content(x!.e.checklistVersionId);
      const verdicts = await tx.select().from(auditItemVerdicts).where(eq(auditItemVerdicts.auditId, auditId));
      const corrections = await tx
        .select({ itemId: executionCorrections.itemId, reason: executionCorrections.reason, actorName: users.fullName })
        .from(executionCorrections)
        .leftJoin(users, eq(users.id, executionCorrections.actorUserId))
        .where(eq(executionCorrections.executionId, x!.e.id))
        .orderBy(asc(executionCorrections.at), asc(executionCorrections.id));
      const problems = await tx
        .select({ itemId: executionProblems.itemId, severity: executionProblems.severity, note: executionProblems.note })
        .from(executionProblems)
        .where(and(eq(executionProblems.executionId, x!.e.id), isNull(executionProblems.clearedAt)));
      const media: Media[] = await tx
        .select({ id: executionMedia.id, kind: executionMedia.kind, status: executionMedia.status, storageKey: executionMedia.storageKey })
        .from(executionMedia)
        .where(eq(executionMedia.executionId, x!.e.id));
      return { a, x: x!, tenant: tenant!, locale, content, verdicts, corrections, problems, media };
    });
    if (!plan) return null;
    const { a, x, tenant, locale, content, verdicts, corrections, problems, media } = plan;
    const answers = x.e.answers as Answers;
    const original = (x.e.originalAnswers as Answers | null) ?? null;
    const visible = visibleItems(content, answers);
    const byId = new Map(media.map((m) => [m.id, m]));
    // Only uploaded photos can be embedded; the selection keeps checklist order.
    const photosOf = new Map(visible.map((v) => [v.item.id, (answers[v.item.id]?.photos ?? []).filter((id) => byId.get(id)?.status === 'uploaded')]));
    const { embedded, skipped } = selectReportPhotos(visible.map((v) => v.item.id), photosOf);
    // A photo that cannot be read or decoded is skipped and counted as not embedded; it never fails the report.
    const ids = [...embedded.values()].flat();
    const urls = await mapLimit(ids, PHOTO_FETCH_CONCURRENCY, async (id): Promise<string | null> => {
      try {
        const body = await this.s3.getObject(byId.get(id)!.storageKey);
        return body ? imageDataUrl(body) : null;
      } catch (e) {
        this.logger.warn(sanitiseForLog(e, null), `A photo of audit ${auditId} could not be read; the report goes without it`);
        return null;
      }
    });
    const dataUrls = new Map<string, string>();
    ids.forEach((id, i) => {
      const url = urls[i];
      if (url) dataUrls.set(id, url);
    });
    const latestCorrection = new Map(corrections.map((c) => [c.itemId, c]));
    const sections = content.sections.map((s) => ({
      title: s.title,
      items: visible
        .filter((v) => v.sectionId === s.id)
        .map(({ item, depth }): ReportItem => {
          const current = answers[item.id];
          const changed = original !== null && !answersEqual(original[item.id], current);
          const correction = changed ? latestCorrection.get(item.id) : undefined;
          const verdict = verdicts.find((v) => v.itemId === item.id);
          const itemProblems = problems.filter((p) => p.itemId === item.id);
          const problem = itemProblems.find((p) => p.severity === 'critical') ?? itemProblems[0];
          const shown = (embedded.get(item.id) ?? []).map((id) => dataUrls.get(id)).filter((u): u is string => u !== undefined);
          const notShown = (embedded.get(item.id)?.length ?? 0) - shown.length;
          return {
            itemId: item.id,
            label: item.label,
            depth,
            answer: answerLine(item, current, locale),
            original: changed ? answerLine(item, original![item.id], locale) : null,
            correctedBy: correction ? { name: correction.actorName ?? 'Taskop', reason: correction.reason } : null,
            verdict: verdict?.verdict ?? null,
            verdictComment: verdict?.comment ?? null,
            problem: problem ? { severity: problem.severity, note: problem.note } : null,
            photos: shown,
            morePhotos: (skipped.get(item.id) ?? 0) + notShown,
            videos: current?.videos?.length ?? 0,
          };
        }),
    }));
    return {
      auditId,
      tenantName: tenant.name,
      timezone: tenant.timezone,
      checklistName: x.checklistName,
      versionNumber: x.versionNumber ?? 0,
      siteName: x.siteName,
      executorName: x.executorName,
      localDate: x.o.localDate,
      window: { startsAt: x.o.startsAt, closesAt: x.o.closesAt },
      startedAt: x.e.startedAt,
      completedAt: x.e.completedAt,
      syncedAt: x.e.completedReceivedAt,
      auditorName: a.auditorName ?? 'Taskop',
      finishedAt: a.audit.finishedAt!,
      result: a.audit.result!,
      auditScore: a.audit.auditScore as AuditScore,
      runScore: (x.e.score as ScoreResult | null)?.percent ?? null,
      originalScore: x.e.originalCapturedAt ? ((x.e.originalScore as ScoreResult | null)?.percent ?? null) : null,
      comment: a.audit.comment,
      sections,
      generatedAt: new Date(),
      locale,
    };
  }
}
