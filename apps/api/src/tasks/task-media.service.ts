import { Injectable } from '@nestjs/common';
import { isFinalTaskStatus, MEDIA_LIMITS, type MediaConfirmResult, type MediaUploadTicket, type MediaUrl, TASK_LIMITS, type TaskEvidence, type TaskMediaRole } from '@taskop/contracts';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { executionMedia, executionProblems, taskMedia, tasks } from '../db/schema';
import { assertStored, signView, storageCap, tooLarge } from '../executions/media.service';
import { S3Service } from '../storage/s3.service';
import type { TaskMediaRegisterDto } from './dto';
import { type TaskRow, TaskScope } from './task-scope';
import { assertNotFuture } from './task-time';

export type TaskMediaRow = typeof taskMedia.$inferSelect;

/** Task photos and videos (spec §6.2). Files go straight to storage; the API only signs and checks. */
@Injectable()
export class TaskMediaService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly s3: S3Service,
    private readonly scope: TaskScope,
  ) {}

  /**
   * POST /tasks/:id/media: registers the medium as pending and returns a presigned PUT. The same id again returns a
   * fresh URL while pending and no URL once uploaded, whatever the task's status now (spec Decision 9) — as long as
   * the uploader may still read the task (response media: ruling R4).
   */
  async register(p: Principal, taskId: string, cmd: TaskMediaRegisterDto): Promise<MediaUploadTicket> {
    const tx = this.db.tx();
    const receivedAt = this.clock.now();
    const t = await this.scope.lock(taskId);
    const [known] = await tx.select().from(taskMedia).where(eq(taskMedia.id, cmd.id));
    if (known) {
      if (known.taskId !== taskId || known.capturedByUserId !== p.userId) throw new AppError('NOT_FOUND');
      // A reassigned-away uploader no longer gets URLs for the task's media.
      if (known.role === 'response' && !(await this.scope.access(p, taskId)).canRead) throw new AppError('NOT_FOUND');
      // A fresh PUT URL for a confirmed medium would let its uploader overwrite stored evidence.
      if (known.status === 'uploaded') return { mediaId: known.id, status: 'uploaded', uploadUrl: null, headers: {}, expiresAt: null };
      return this.ticket(known);
    }
    await this.assertMayAttach(p, t, cmd.role);
    assertNotFuture(new Date(cmd.capturedAt), receivedAt);
    if (!(MEDIA_LIMITS.mimeTypes[cmd.kind] as readonly string[]).includes(cmd.mime)) throw new AppError('MEDIA_TYPE_INVALID');
    if (tooLarge(cmd)) throw new AppError('MEDIA_TOO_LARGE');
    await this.assertRoom(p, t, cmd);
    const ext = MEDIA_LIMITS.extensions[cmd.mime as keyof typeof MEDIA_LIMITS.extensions];
    const [row] = await tx
      .insert(taskMedia)
      .values({
        id: cmd.id,
        tenantId: p.tenantId,
        taskId,
        role: cmd.role,
        kind: cmd.kind,
        source: cmd.source,
        mime: cmd.mime,
        bytes: cmd.bytes,
        width: cmd.width ?? null,
        height: cmd.height ?? null,
        durationMs: cmd.durationMs ?? null,
        capturedAt: new Date(cmd.capturedAt),
        capturedByUserId: p.userId,
        storageKey: `t/${p.tenantId}/k/${taskId}/${cmd.id}.${ext}`,
        createdAt: receivedAt,
      })
      .returning();
    return this.ticket(row!);
  }

  /**
   * POST /task-media/:id/uploaded: the uploader only, and only while they can still read the task (ruling R4); the
   * object must exist with the registered size and type. The row is locked first, so task-media.cleanup cannot delete
   * the object between the check and the update.
   */
  async confirmUploaded(p: Principal, mediaId: string): Promise<MediaConfirmResult> {
    const tx = this.db.tx();
    const [m] = await tx.select().from(taskMedia).where(eq(taskMedia.id, mediaId)).for('update');
    if (!m || !(await this.scope.access(p, m.taskId)).canRead) throw new AppError('NOT_FOUND');
    if (m.capturedByUserId !== p.userId) throw new AppError('FORBIDDEN');
    if (m.status === 'uploaded') return { mediaId, status: 'uploaded', uploadedAt: m.uploadedAt?.toISOString() ?? null };
    await assertStored(this.s3, m);
    const now = this.clock.now();
    await tx.update(taskMedia).set({ status: 'uploaded', uploadedAt: now, storagePurgedAt: null }).where(eq(taskMedia.id, mediaId));
    return { mediaId, status: 'uploaded', uploadedAt: now.toISOString() };
  }

  /** GET /task-media/:id/url: a 5-minute presigned GET for anyone who can read the task (NFR-10.02). */
  async viewUrl(p: Principal, mediaId: string): Promise<MediaUrl> {
    const [m] = await this.db.tx().select().from(taskMedia).where(eq(taskMedia.id, mediaId));
    if (!m || !(await this.scope.access(p, m.taskId)).canRead) throw new AppError('NOT_FOUND');
    if (m.status !== 'uploaded') throw new AppError('MEDIA_NOT_FOUND_IN_STORAGE');
    return signView(this.s3, m.storageKey);
  }

  /** GET /tasks/:id/problem-media/:mediaId/url (spec Decision 14): the source problem's media, for task readers. */
  async problemMediaUrl(p: Principal, taskId: string, mediaId: string): Promise<MediaUrl> {
    if (!(await this.scope.access(p, taskId)).canRead) throw new AppError('NOT_FOUND');
    const [m] = await this.db
      .tx()
      .select({ storageKey: executionMedia.storageKey, status: executionMedia.status })
      .from(tasks)
      .innerJoin(executionProblems, eq(executionProblems.id, tasks.problemId))
      .innerJoin(executionMedia, eq(executionMedia.executionId, executionProblems.executionId))
      .where(and(eq(tasks.id, taskId), eq(executionMedia.id, mediaId), sql`${executionMedia.id} = any(${executionProblems.mediaIds})`));
    if (!m) throw new AppError('NOT_FOUND');
    if (m.status !== 'uploaded') throw new AppError('MEDIA_NOT_FOUND_IN_STORAGE');
    return signView(this.s3, m.storageKey);
  }

  /** Instruction media: the creator or a manager, while the task is open. Response media: the assignee, once accepted. */
  private async assertMayAttach(p: Principal, t: TaskRow, role: TaskMediaRole): Promise<void> {
    if (role === 'instruction') {
      await this.scope.assertManage(p, t);
      if (isFinalTaskStatus(t.status)) throw new AppError('TASK_STATE_INVALID');
      return;
    }
    await this.scope.assertWorker(p, t);
    if (t.assigneeUserId !== p.userId || (t.status !== 'accepted' && t.status !== 'in_progress')) throw new AppError('TASK_STATE_INVALID');
  }

  /**
   * Live-only and evidence levels (FR-12.05–06) and the registration caps (spec Decision 20). The response cap counts
   * the caller's own unsubmitted registrations, so a previous assignee's leftovers never block the new one (ruling R15).
   */
  private async assertRoom(p: Principal, t: TaskRow, cmd: TaskMediaRegisterDto): Promise<void> {
    const tx = this.db.tx();
    if (cmd.role === 'instruction') {
      const [r] = await tx.select({ n: count() }).from(taskMedia).where(and(eq(taskMedia.taskId, t.id), eq(taskMedia.role, 'instruction')));
      if ((r?.n ?? 0) >= TASK_LIMITS.instructionMedia) throw new AppError('MEDIA_LIMIT_REACHED');
      return;
    }
    const evidence = t.evidence as TaskEvidence;
    if (evidence.liveOnly && cmd.source === 'gallery') throw new AppError('EVIDENCE_LIVE_ONLY');
    if (evidence[cmd.kind] === 'none') throw new AppError('MEDIA_LIMIT_REACHED');
    const limit = cmd.kind === 'photo' ? TASK_LIMITS.responsePhotos : TASK_LIMITS.responseVideos;
    const [r] = await tx
      .select({ n: count() })
      .from(taskMedia)
      .where(and(eq(taskMedia.taskId, t.id), eq(taskMedia.role, 'response'), eq(taskMedia.kind, cmd.kind), eq(taskMedia.capturedByUserId, p.userId), isNull(taskMedia.submissionId)));
    if ((r?.n ?? 0) >= storageCap(limit)) throw new AppError('MEDIA_LIMIT_REACHED');
  }

  private async ticket(m: TaskMediaRow): Promise<MediaUploadTicket> {
    const put = await this.s3.presignPut(m.storageKey, m.mime, m.bytes);
    return { mediaId: m.id, status: m.status, uploadUrl: put.url, headers: put.headers, expiresAt: put.expiresAt.toISOString() };
  }
}
