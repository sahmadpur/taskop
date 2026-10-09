import { Injectable, Logger } from '@nestjs/common';
import {
  type Answers,
  answerIssues,
  type ChecklistContent,
  type ClaimRejectionReason,
  type ClaimResult,
  type CompleteResult,
  computeScore,
  type ExecutionProgress,
  progress,
  requirements,
  type SaveAnswersResult,
  type ScoreResult,
} from '@taskop/contracts';
import { desc, eq, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { checklists, checklistVersions, executions, occurrences } from '../db/schema';
import { EligibilityService } from '../scheduling/eligibility.service';
import { OccurrenceWriter } from '../scheduling/occurrence-writer';
import { assertDeviceTimes, clampStart } from './device-time';
import type { ClaimCommandDto, CompleteCommandDto, SaveAnswersCommandDto } from './dto';
import { ExecutionLookups } from './execution-lookups';
import { ProblemWriter } from './problem-writer';

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
    private readonly problems: ProblemWriter,
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

  /** Spec §6.3. A stale revision is ignored before any state check, so a late, older command never fails. */
  async saveAnswers(p: Principal, id: string, cmd: SaveAnswersCommandDto): Promise<SaveAnswersResult> {
    const receivedAt = this.clock.now();
    const { e, o } = await this.lockForCommand(p, id);
    const deviceTime = new Date(cmd.deviceTime);
    const bounds = assertDeviceTimes([deviceTime], receivedAt, cmd.clientOffsetMs);
    if (cmd.rev <= e.answersRev) return this.answersResult(e, true);
    // A swept partial still takes answers captured inside the window (they synced late); nothing after it.
    if (e.state === 'completed' || (e.state === 'partial' && (e.completedAt !== null || deviceTime >= o.closesAt))) {
      throw new AppError('EXECUTION_NOT_ACTIVE');
    }
    const content = await this.lookups.content(e.checklistVersionId);
    await this.assertValidAnswers(content, e.id, cmd.answers);
    const counted = e.state !== 'rejected';
    const [row] = await this.db
      .tx()
      .update(executions)
      .set({
        ...this.answersColumns(e, cmd.answers, cmd.rev, cmd.clientOffsetMs, bounds.clockSuspect, receivedAt),
        // Rejected executions keep the answers only: stored, never counted.
        ...(counted ? { progress: progress(content, cmd.answers), score: computeScore(content, cmd.answers) } : {}),
      })
      .where(eq(executions.id, id))
      .returning();
    if (counted) {
      await this.problems.rewrite(e, o, content, cmd.answers, receivedAt);
      if (o.status === 'started') {
        await this.writer.applyTransitions([{ occurrenceId: o.id, from: 'started', to: 'in_progress', at: deviceTime > e.startedAt ? deviceTime : e.startedAt }]);
      }
    }
    return this.answersResult(row!, false);
  }

  /**
   * Spec §6.4. Saves the answers (when newer), checks requirements on the pinned version, then decides by device time:
   * completedAt < closes_at → completed (reviving a swept partial), otherwise partial. Score and problems are frozen.
   */
  async complete(p: Principal, id: string, cmd: CompleteCommandDto): Promise<CompleteResult> {
    const receivedAt = this.clock.now();
    const { e, o } = await this.lockForCommand(p, id);
    const bounds = assertDeviceTimes([new Date(cmd.deviceTime), new Date(cmd.completedAt)], receivedAt, cmd.clientOffsetMs);
    if (e.completedAt) return this.completeResult(e);
    const content = await this.lookups.content(e.checklistVersionId);
    const fresh = cmd.rev > e.answersRev;
    if (fresh) await this.assertValidAnswers(content, e.id, cmd.answers);
    const answers: Answers = fresh ? cmd.answers : (e.answers as Answers);
    const completedAt = new Date(Math.max(+new Date(cmd.completedAt), +e.startedAt));
    const base = {
      ...this.answersColumns(e, answers, fresh ? cmd.rev : e.answersRev, cmd.clientOffsetMs, bounds.clockSuspect, receivedAt),
      completedAt,
      completedReceivedAt: receivedAt,
    };
    const tx = this.db.tx();
    if (e.state === 'rejected') {
      const [row] = await tx.update(executions).set(base).where(eq(executions.id, id)).returning();
      return this.completeResult(row!);
    }
    const missing = requirements(content, answers);
    if (missing.length) throw new AppError('REQUIREMENTS_UNMET', { details: { missing } });
    const inWindow = completedAt < o.closesAt;
    const [row] = await tx
      .update(executions)
      .set({
        ...base,
        state: inWindow ? 'completed' : 'partial',
        progress: progress(content, answers),
        score: computeScore(content, answers),
        late: completedAt >= o.dueAt,
      })
      .where(eq(executions.id, id))
      .returning();
    await this.problems.rewrite(e, o, content, answers, receivedAt);
    if (inWindow) {
      await this.writer.applyTransitions([
        { occurrenceId: o.id, from: o.status, to: 'completed', at: completedAt, reason: o.status === 'partial' ? 'late_sync' : null },
      ]);
    } else if (o.status !== 'partial') {
      await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: 'partial', at: o.closesAt }]);
    }
    return this.completeResult(row!);
  }

  private completeResult(e: ExecutionRow): CompleteResult {
    return {
      executionId: e.id,
      state: e.state,
      completedAt: e.completedAt?.toISOString() ?? null,
      late: e.late,
      progress: e.progress as ExecutionProgress,
      score: (e.score as ScoreResult | null) ?? null,
    };
  }

  /** The columns every accepted answers save (PUT or complete) writes. */
  private answersColumns(e: ExecutionRow, answers: Answers, rev: number, clientOffsetMs: number, suspect: boolean, receivedAt: Date) {
    return {
      answers,
      answersRev: rev,
      lastSyncedAt: receivedAt,
      clockOffsetMs: clientOffsetMs,
      clockSuspect: e.clockSuspect || suspect,
      updatedAt: receivedAt,
    };
  }

  /** Locks the occurrence, then the execution (the order every command uses), and checks the executor. */
  private async lockForCommand(p: Principal, id: string): Promise<{ e: ExecutionRow; o: OccurrenceRow }> {
    const tx = this.db.tx();
    const [found] = await tx.select({ occurrenceId: executions.occurrenceId }).from(executions).where(eq(executions.id, id));
    if (!found) throw new AppError('NOT_FOUND');
    const [o] = await tx.select().from(occurrences).where(eq(occurrences.id, found.occurrenceId)).for('update');
    const [e] = await tx.select().from(executions).where(eq(executions.id, id)).for('update');
    if (e!.executorUserId !== p.userId) throw new AppError('NOT_EXECUTOR');
    return { e: e!, o: o! };
  }

  /** Item ids, value types and media against the pinned version (spec §6.3) → 400 VALIDATION_FAILED with issues. */
  private async assertValidAnswers(content: ChecklistContent, executionId: string, answers: Answers): Promise<void> {
    const issues = answerIssues(content, answers, await this.lookups.mediaKinds(executionId));
    if (issues.length) throw new AppError('VALIDATION_FAILED', { details: { issues } });
  }

  private answersResult(e: ExecutionRow, stale: boolean): SaveAnswersResult {
    return { executionId: e.id, rev: e.answersRev, stale, state: e.state, progress: e.progress as ExecutionProgress };
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
