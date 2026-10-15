import { Injectable } from '@nestjs/common';
import type { Answer, ReworkItem, ReworkRequest } from '@taskop/contracts';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { executionReworkRequests, users } from '../db/schema';

export type ReworkRequestRow = typeof executionReworkRequests.$inferSelect;

/** Send-back rows of executions (SP8 spec §4.2). Run inside the tenant transaction. */
@Injectable()
export class ReworkRequests {
  constructor(private readonly db: DbService) {}

  /** The open request: neither resubmitted nor withdrawn. At most one (execution_rework_requests_open_uq). */
  async open(executionId: string): Promise<ReworkRequestRow | null> {
    const [r] = await this.db
      .tx()
      .select()
      .from(executionReworkRequests)
      .where(and(eq(executionReworkRequests.executionId, executionId), isNull(executionReworkRequests.resubmittedAt), isNull(executionReworkRequests.withdrawnAt)));
    return r ?? null;
  }

  /** The request of one round, whatever its outcome. */
  async byRound(executionId: string, round: number): Promise<ReworkRequestRow | null> {
    const [r] = await this.db
      .tx()
      .select()
      .from(executionReworkRequests)
      .where(and(eq(executionReworkRequests.executionId, executionId), eq(executionReworkRequests.round, round)));
    return r ?? null;
  }

  async latest(executionId: string): Promise<ReworkRequestRow | null> {
    const [r] = await this.db
      .tx()
      .select()
      .from(executionReworkRequests)
      .where(eq(executionReworkRequests.executionId, executionId))
      .orderBy(desc(executionReworkRequests.round))
      .limit(1);
    return r ?? null;
  }

  async all(executionId: string): Promise<ReworkRequestRow[]> {
    return this.db.tx().select().from(executionReworkRequests).where(eq(executionReworkRequests.executionId, executionId)).orderBy(asc(executionReworkRequests.round));
  }

  /** The open request of each execution that has one (/me/sync, Spec decision 8). */
  async openByExecution(executionIds: string[]): Promise<Map<string, ReworkRequest>> {
    if (!executionIds.length) return new Map();
    const rows = await this.db
      .tx()
      .select()
      .from(executionReworkRequests)
      .where(and(inArray(executionReworkRequests.executionId, executionIds), isNull(executionReworkRequests.resubmittedAt), isNull(executionReworkRequests.withdrawnAt)));
    const dtos = await this.toDtos(rows);
    return new Map(rows.map((r, i) => [r.executionId, dtos[i]!]));
  }

  async toDtos(rows: ReworkRequestRow[]): Promise<ReworkRequest[]> {
    const ids = [...new Set(rows.flatMap((r) => [r.requestedByUserId, r.withdrawnByUserId]).filter((id): id is string => id !== null))];
    const names = ids.length ? await this.db.tx().select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
    const ref = (id: string | null) => {
      const u = id ? names.find((n) => n.id === id) : undefined;
      return u ? { id: u.id, fullName: u.fullName } : null;
    };
    return rows.map((r) => ({
      id: r.id,
      round: r.round,
      items: r.items as ReworkItem[],
      dueAt: r.dueAt?.toISOString() ?? null,
      requestedBy: ref(r.requestedByUserId),
      requestedAt: r.requestedAt.toISOString(),
      resubmittedAt: r.resubmittedAt?.toISOString() ?? null,
      withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
      withdrawnBy: ref(r.withdrawnByUserId),
      answersBefore: r.answersBefore as Record<string, Answer>,
    }));
  }
}
