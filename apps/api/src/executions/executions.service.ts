import { Injectable, Logger } from '@nestjs/common';
import { type ClaimRejectionReason, type ClaimResult, progress } from '@taskop/contracts';
import { desc, eq, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { checklists, checklistVersions, executions, occurrences } from '../db/schema';
import { EligibilityService } from '../scheduling/eligibility.service';
import { OccurrenceWriter } from '../scheduling/occurrence-writer';
import { assertDeviceTimes, clampStart } from './device-time';
import type { ClaimCommandDto } from './dto';
import { ExecutionLookups } from './execution-lookups';

export type ExecutionRow = typeof executions.$inferSelect;
export type OccurrenceRow = typeof occurrences.$inferSelect;

/**
 * The phone's upload commands (spec §6.2–6.4). Each runs in the request's tenant transaction and is idempotent.
 * Lock order: the occurrence row, then the execution row (the sweep skips locked occurrences).
 */
@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger('ExecutionsService');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly eligibility: EligibilityService,
    private readonly writer: OccurrenceWriter,
    private readonly lookups: ExecutionLookups,
  ) {}

  /** First claim to reach the server wins (NFR-06.05); a loser is stored as rejected and answered with 200. */
  async claim(p: Principal, cmd: ClaimCommandDto): Promise<ClaimResult> {
    const tx = this.db.tx();
    const receivedAt = this.clock.now();
    const [known] = await tx.select().from(executions).where(eq(executions.id, cmd.id));
    if (known) {
      if (known.executorUserId !== p.userId) throw new AppError('NOT_EXECUTOR');
      return this.claimResult(known);
    }
    const bounds = assertDeviceTimes([new Date(cmd.deviceTime), new Date(cmd.startedAt)], receivedAt, cmd.clientOffsetMs);
    const [o] = await tx.select().from(occurrences).where(eq(occurrences.id, cmd.occurrenceId)).for('update');
    if (!o) throw new AppError('NOT_FOUND');
    // A replay of this very command may have committed while we waited for the lock.
    const [replayed] = await tx.select().from(executions).where(eq(executions.id, cmd.id));
    if (replayed) {
      if (replayed.executorUserId !== p.userId) throw new AppError('NOT_EXECUTOR');
      return this.claimResult(replayed);
    }
    const start = clampStart(new Date(cmd.startedAt), o.startsAt, receivedAt);

    let reason: ClaimRejectionReason | null = (await this.lookups.claims([o.id])).has(o.id) ? 'ALREADY_CLAIMED' : null;
    if (!reason) {
      const r = await this.eligibility.canStart(o.id, p.userId, start.startedAt, { allowMissed: true });
      if (!r.ok) reason = r.reason === 'NOT_FOUND' ? 'NOT_STARTABLE' : r.reason;
    }

    // Only an accepted claim pins the occurrence (spec §5.1); a rejected one just records the version it saw.
    const versionId = reason ? await this.visibleVersion(o) : await this.pinnedVersion(o);
    const content = await this.lookups.content(versionId);
    const values = {
      id: cmd.id,
      tenantId: p.tenantId,
      occurrenceId: o.id,
      checklistVersionId: versionId,
      executorUserId: p.userId,
      startedAt: start.startedAt,
      startedReceivedAt: receivedAt,
      lastSyncedAt: receivedAt,
      progress: progress(content, {}),
      late: start.startedAt >= o.dueAt,
      clockOffsetMs: cmd.clientOffsetMs,
      clockSuspect: bounds.clockSuspect || start.clockSuspect,
      device: cmd.device,
      createdAt: receivedAt,
      updatedAt: receivedAt,
    };
    let row: ExecutionRow | undefined;
    if (!reason) {
      // The occurrence lock already serialises claims; the partial unique index is the last line of defence.
      [row] = await tx
        .insert(executions)
        .values({ ...values, state: 'active' })
        .onConflictDoNothing({ target: executions.occurrenceId, where: sql`state <> 'rejected'` })
        .returning();
      if (!row) reason = 'ALREADY_CLAIMED';
    }
    if (!row) {
      [row] = await tx.insert(executions).values({ ...values, state: 'rejected', rejectedReason: reason }).returning();
      this.logger.log({ executionId: cmd.id, occurrenceId: o.id, userId: p.userId, reason }, 'Claim rejected');
    } else {
      await this.writer.applyTransitions([
        { occurrenceId: o.id, from: o.status, to: 'started', at: start.startedAt, reason: o.status === 'missed' ? 'late_sync' : null },
      ]);
    }
    return this.claimResult(row!);
  }

  /** The occurrence's pinned version, pinning the current one first if needed (spec §5.1). */
  private async pinnedVersion(o: OccurrenceRow): Promise<string> {
    if (o.checklistVersionId) return o.checklistVersionId;
    await this.writer.pinVersions([o.id]);
    const [row] = await this.db.tx().select({ v: occurrences.checklistVersionId }).from(occurrences).where(eq(occurrences.id, o.id));
    if (!row?.v) throw new AppError('CHECKLIST_NOT_PUBLISHED');
    return row.v;
  }

  /** The pinned version, else the checklist's current one, without pinning anything. */
  private async visibleVersion(o: OccurrenceRow): Promise<string> {
    if (o.checklistVersionId) return o.checklistVersionId;
    const [c] = await this.db.tx().select({ v: checklists.currentVersionId }).from(checklists).where(eq(checklists.id, o.checklistId));
    if (c?.v) return c.v;
    // Never fail a rejected claim (it must answer 200): fall back to the newest published version.
    const [latest] = await this.db
      .tx()
      .select({ id: checklistVersions.id })
      .from(checklistVersions)
      .where(eq(checklistVersions.checklistId, o.checklistId))
      .orderBy(desc(checklistVersions.number))
      .limit(1);
    if (!latest) throw new AppError('CHECKLIST_NOT_PUBLISHED');
    return latest.id;
  }

  private async claimResult(e: ExecutionRow): Promise<ClaimResult> {
    return {
      executionId: e.id,
      state: e.state,
      reason: e.rejectedReason,
      claim: (await this.lookups.claims([e.occurrenceId])).get(e.occurrenceId) ?? null,
      checklistVersionId: e.checklistVersionId,
      startedAt: e.startedAt.toISOString(),
      clockSuspect: e.clockSuspect,
    };
  }
}
