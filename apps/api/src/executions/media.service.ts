import { Injectable } from '@nestjs/common';
import { countItems, MEDIA_LIMITS, type MediaConfirmResult, type MediaUploadTicket, type MediaUrl, mediaLimitFor } from '@taskop/contracts';
import { and, count, eq, getTableColumns, isNull } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { executionMedia, executions, occurrences } from '../db/schema';
import { S3Service } from '../storage/s3.service';
import { assertDeviceTimes } from './device-time';
import { ExecutionAccess } from './execution-access';
import type { RegisterMediaCommandDto } from './dto';
import { ExecutionLookups, findItem } from './execution-lookups';
import type { ExecutionRow } from './executions.service';

export type MediaRow = typeof executionMedia.$inferSelect;

const tooLarge = (cmd: RegisterMediaCommandDto): boolean =>
  cmd.kind === 'photo'
    ? cmd.bytes > MEDIA_LIMITS.photoMaxBytes
    : cmd.bytes > MEDIA_LIMITS.videoMaxBytes ||
      (cmd.durationMs ?? 0) > MEDIA_LIMITS.videoMaxSeconds * 1000 ||
      Math.min(cmd.width ?? 0, cmd.height ?? 0) > MEDIA_LIMITS.videoMaxShortEdge;

/**
 * Photos and videos (spec §6.7). The file goes straight from the phone to storage; the API only signs and checks.
 * Lock order: the occurrence row, then the execution row (same as ExecutionsService).
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly s3: S3Service,
    private readonly lookups: ExecutionLookups,
    private readonly access: ExecutionAccess,
  ) {}

  /** Registers the medium as pending and returns a presigned PUT; the same id again returns a fresh URL. */
  async register(p: Principal, executionId: string, cmd: RegisterMediaCommandDto): Promise<MediaUploadTicket> {
    const tx = this.db.tx();
    const receivedAt = this.clock.now();
    const [peek] = await tx.select({ occurrenceId: executions.occurrenceId }).from(executions).where(eq(executions.id, executionId));
    if (!peek) throw new AppError('NOT_FOUND');
    const [o] = await tx.select().from(occurrences).where(eq(occurrences.id, peek.occurrenceId)).for('update');
    const [e] = await tx.select().from(executions).where(eq(executions.id, executionId)).for('update');
    if (!o || !e) throw new AppError('NOT_FOUND');
    if (e.executorUserId !== p.userId) throw new AppError('NOT_EXECUTOR');
    const [known] = await tx.select().from(executionMedia).where(eq(executionMedia.id, cmd.id));
    if (known) {
      if (known.executionId !== executionId) throw new AppError('NOT_FOUND');
      // A fresh PUT URL for a confirmed medium would let the executor overwrite stored evidence.
      if (known.status === 'uploaded') throw new AppError('EXECUTION_NOT_ACTIVE');
      return this.ticket(known);
    }
    const capturedAt = new Date(cmd.capturedAt);
    const bounds = assertDeviceTimes([new Date(cmd.deviceTime), capturedAt], receivedAt, cmd.clientOffsetMs);
    // A swept partial execution (no completed_at) is revived by late syncs: it still takes media captured inside the window.
    const open = e.state === 'partial' ? e.completedAt === null && capturedAt < o.closesAt : e.state !== 'completed';
    if (!open) throw new AppError('EXECUTION_NOT_ACTIVE');
    if (!(MEDIA_LIMITS.mimeTypes[cmd.kind] as readonly string[]).includes(cmd.mime)) throw new AppError('MEDIA_TYPE_INVALID');
    if (tooLarge(cmd)) throw new AppError('MEDIA_TOO_LARGE');
    await this.assertRoom(e, cmd);
    const ext = MEDIA_LIMITS.extensions[cmd.mime as keyof typeof MEDIA_LIMITS.extensions];
    const [row] = await tx
      .insert(executionMedia)
      .values({
        id: cmd.id,
        tenantId: p.tenantId,
        executionId,
        itemId: cmd.itemId,
        kind: cmd.kind,
        source: cmd.source,
        mime: cmd.mime,
        bytes: cmd.bytes,
        width: cmd.width ?? null,
        height: cmd.height ?? null,
        durationMs: cmd.durationMs ?? null,
        capturedAt,
        capturedByUserId: p.userId,
        storageKey: `t/${p.tenantId}/e/${executionId}/${cmd.id}.${ext}`,
        createdAt: receivedAt,
      })
      .returning();
    await tx
      .update(executions)
      .set({ lastSyncedAt: receivedAt, clockOffsetMs: cmd.clientOffsetMs, clockSuspect: e.clockSuspect || bounds.clockSuspect, updatedAt: receivedAt })
      .where(eq(executions.id, executionId));
    return this.ticket(row!);
  }

  /** POST /media/:id/uploaded: the object must exist with the registered size and type (spec §6.7). */
  async confirmUploaded(p: Principal, mediaId: string): Promise<MediaConfirmResult> {
    const tx = this.db.tx();
    const [row] = await tx
      .select({ m: getTableColumns(executionMedia), executorUserId: executions.executorUserId })
      .from(executionMedia)
      .innerJoin(executions, eq(executions.id, executionMedia.executionId))
      .where(eq(executionMedia.id, mediaId));
    if (!row) throw new AppError('NOT_FOUND');
    if (row.executorUserId !== p.userId) throw new AppError('NOT_EXECUTOR');
    if (row.m.status === 'uploaded') return { mediaId, status: 'uploaded', uploadedAt: row.m.uploadedAt?.toISOString() ?? null };
    const stored = await this.s3.head(row.m.storageKey);
    if (!stored || stored.contentLength !== row.m.bytes || stored.contentType !== row.m.mime) throw new AppError('MEDIA_NOT_FOUND_IN_STORAGE');
    const now = this.clock.now();
    await tx.update(executionMedia).set({ status: 'uploaded', uploadedAt: now, storagePurgedAt: null }).where(eq(executionMedia.id, mediaId));
    return { mediaId, status: 'uploaded', uploadedAt: now.toISOString() };
  }

  /** GET /media/:id/url: a 5-minute presigned GET after the permission check (NFR-10.02). */
  async viewUrl(p: Principal, mediaId: string): Promise<MediaUrl> {
    const [row] = await this.db
      .tx()
      .select({ m: getTableColumns(executionMedia), executorUserId: executions.executorUserId, occurrenceId: executions.occurrenceId })
      .from(executionMedia)
      .innerJoin(executions, eq(executions.id, executionMedia.executionId))
      .where(eq(executionMedia.id, mediaId));
    if (!row) throw new AppError('NOT_FOUND');
    await this.access.assertCanRead(p, row.executorUserId, row.occurrenceId);
    if (row.m.status !== 'uploaded') throw new AppError('MEDIA_NOT_FOUND_IN_STORAGE');
    const get = await this.s3.presignGet(row.m.storageKey);
    return { url: get.url, expiresAt: get.expiresAt.toISOString() };
  }

  /** Item, kind, live-only (FR-12.05–06) and count checks against the pinned version. */
  private async assertRoom(e: ExecutionRow, cmd: RegisterMediaCommandDto): Promise<void> {
    const content = await this.lookups.content(e.checklistVersionId);
    const tx = this.db.tx();
    if (cmd.itemId === null) {
      // Problem-only media: the exact "≤ 5 per problem" is checked on the answers; this caps storage per execution.
      const [r] = await tx.select({ n: count() }).from(executionMedia).where(and(eq(executionMedia.executionId, e.id), isNull(executionMedia.itemId)));
      if ((r?.n ?? 0) >= MEDIA_LIMITS.problemMaxMedia * countItems(content)) throw new AppError('MEDIA_LIMIT_REACHED');
      return;
    }
    const item = findItem(content, cmd.itemId);
    if (!item) throw new AppError('VALIDATION_FAILED', { fields: { itemId: 'executions.issues.unknownItem' } });
    if ((item.type === 'photo' || item.type === 'video') && item.type !== cmd.kind) throw new AppError('MEDIA_TYPE_INVALID');
    if (item.evidence.liveOnly && cmd.source === 'gallery') throw new AppError('EVIDENCE_LIVE_ONLY');
    const [r] = await tx
      .select({ n: count() })
      .from(executionMedia)
      .where(and(eq(executionMedia.executionId, e.id), eq(executionMedia.itemId, item.id), eq(executionMedia.kind, cmd.kind)));
    if ((r?.n ?? 0) >= mediaLimitFor(item, cmd.kind)) throw new AppError('MEDIA_LIMIT_REACHED');
  }

  private async ticket(m: MediaRow): Promise<MediaUploadTicket> {
    const put = await this.s3.presignPut(m.storageKey, m.mime, m.bytes);
    return { mediaId: m.id, status: m.status, uploadUrl: put.url, headers: put.headers, expiresAt: put.expiresAt.toISOString() };
  }
}
