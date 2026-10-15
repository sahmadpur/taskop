import { Injectable } from '@nestjs/common';
import { type Answer, type AnswerDiff, type Answers, answersEqual, type Correction, type ExecutionCorrections, type ScoreResult, walkItems } from '@taskop/contracts';
import { asc, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { executionCorrections, executions, users } from '../db/schema';
import { ExecutionLookups } from './execution-lookups';
import { ReworkRequests } from './rework-requests';

type CorrectionRow = { c: typeof executionCorrections.$inferSelect; actorName: string | null };

const toCorrection = (r: CorrectionRow): Correction => ({
  id: r.c.id,
  itemId: r.c.itemId,
  kind: r.c.kind,
  round: r.c.round,
  before: (r.c.before as Answer | null) ?? null,
  after: (r.c.after as Answer | null) ?? null,
  reason: r.c.reason,
  actor: r.c.actorPlatformAdminId ? { kind: 'platform', name: null } : { kind: 'user', name: r.actorName },
  at: r.c.at.toISOString(),
});

/** The correction history of a run (SP8 spec §6.2, NFR-07.05). Callers check read access first. */
@Injectable()
export class CorrectionHistory {
  constructor(
    private readonly db: DbService,
    private readonly lookups: ExecutionLookups,
    private readonly requests: ReworkRequests,
  ) {}

  async of(executionId: string): Promise<ExecutionCorrections> {
    const tx = this.db.tx();
    const [x] = await tx
      .select({
        answers: executions.answers,
        versionId: executions.checklistVersionId,
        originalAnswers: executions.originalAnswers,
        originalScore: executions.originalScore,
        originalCapturedAt: executions.originalCapturedAt,
      })
      .from(executions)
      .where(eq(executions.id, executionId));
    if (!x) throw new AppError('NOT_FOUND');
    const rows = await tx
      .select({ c: getTableColumns(executionCorrections), actorName: users.fullName })
      .from(executionCorrections)
      .leftJoin(users, eq(users.id, executionCorrections.actorUserId))
      .where(eq(executionCorrections.executionId, executionId))
      .orderBy(asc(executionCorrections.at), asc(executionCorrections.id));
    const original = x.originalCapturedAt
      ? { answers: x.originalAnswers as Record<string, Answer>, score: (x.originalScore as ScoreResult | null) ?? null, capturedAt: x.originalCapturedAt.toISOString() }
      : null;
    const diff: AnswerDiff[] = [];
    if (original) {
      const current = x.answers as Answers;
      walkItems(await this.lookups.content(x.versionId), (item) => {
        const before = original.answers[item.id];
        const now = current[item.id];
        if (!answersEqual(before, now)) diff.push({ itemId: item.id, original: before ?? null, current: now ?? null });
      });
    }
    return { original, corrections: rows.map(toCorrection), reworkRequests: await this.requests.toDtos(await this.requests.all(executionId)), diff };
  }
}
