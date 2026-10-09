import { Injectable, Logger } from '@nestjs/common';
import type { OccurrenceStatus } from '@taskop/contracts';
import { asc, eq, type SQL, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { sanitiseForLog } from '../common/error.filter';
import { DbService } from '../db/db.service';
import { assignments } from '../db/schema';
import { OccurrenceWriter, type Transition } from './occurrence-writer';

interface SweptRow extends Record<string, unknown> {
  id: string;
  from_status: Extract<OccurrenceStatus, 'pending' | 'overdue'>;
  to_status: Extract<OccurrenceStatus, 'overdue' | 'missed'>;
  due_at: Date | string;
  closes_at: Date | string;
  created_at: Date | string;
}

/** The bodies of the two cron jobs (spec §5.1, §5.2). One transaction per tenant, with RLS. */
@Injectable()
export class OccurrenceJobs {
  private readonly logger = new Logger('OccurrenceJobs');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly writer: OccurrenceWriter,
  ) {}

  /** Keeps every active assignment materialised 14 days ahead. */
  async materializeAll(only?: string[]): Promise<number> {
    const tenantIds = await this.tenantsWith(sql`select distinct tenant_id from assignments where status = 'active'`, only);
    return this.perTenant(tenantIds, async () => {
      // In id order, like every change that locks several assignments, so concurrent runs never deadlock.
      const rows = await this.db.tx().select({ id: assignments.id }).from(assignments).where(eq(assignments.status, 'active')).orderBy(asc(assignments.id));
      let created = 0;
      for (const r of rows) created += await this.writer.materialize(r.id);
      return created;
    });
  }

  /** pending → overdue after due_at; pending | overdue → missed after closes_at. */
  async sweepAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const tenantIds = await this.tenantsWith(
      sql`select distinct tenant_id from occurrences
          where (status = 'pending' and due_at <= ${now}) or (status = 'overdue' and closes_at <= ${now})`,
      only,
    );
    return this.perTenant(tenantIds, () => this.sweepTenant(now));
  }

  /** Guarded by the current status and SKIP LOCKED, so two runs never double-move a row. */
  async sweepTenant(now: Date): Promise<number> {
    const result = await this.db.tx().execute<SweptRow>(sql`
      with due as (
        select id, status, due_at, closes_at, created_at from occurrences
        where (status = 'pending' and due_at <= ${now}) or (status = 'overdue' and closes_at <= ${now})
        for update skip locked
      )
      update occurrences o
         set status = (case when due.closes_at <= ${now} then 'missed' else 'overdue' end)::occurrence_status,
             -- An occurrence created after its due or close time changes status no earlier than its creation.
             status_changed_at = greatest(case when due.closes_at <= ${now} then due.closes_at else due.due_at end, due.created_at),
             updated_at = ${now}
        from due
       where o.id = due.id
      returning o.id, due.status as from_status, o.status as to_status, due.due_at, due.closes_at, due.created_at`);
    const transitions: Transition[] = [];
    for (const row of result.rows) {
      // Drizzle's pg driver returns raw timestamp strings from `execute`, not Dates.
      const created = new Date(row.created_at);
      const notBeforeCreation = (d: Date | string) => new Date(Math.max(+new Date(d), +created));
      const r = { ...row, due_at: notBeforeCreation(row.due_at), closes_at: notBeforeCreation(row.closes_at) };
      if (r.from_status === 'pending' && r.to_status === 'missed' && r.due_at < r.closes_at) {
        // Down across the whole window: record both steps at their real times.
        transitions.push(
          { occurrenceId: r.id, from: 'pending', to: 'overdue', at: r.due_at },
          { occurrenceId: r.id, from: 'overdue', to: 'missed', at: r.closes_at },
        );
      } else {
        transitions.push({ occurrenceId: r.id, from: r.from_status, to: r.to_status, at: r.to_status === 'missed' ? r.closes_at : r.due_at });
      }
    }
    await this.writer.recordTransitions(transitions);
    return result.rows.length;
  }

  private async tenantsWith(query: SQL, only?: string[]): Promise<string[]> {
    const r = await this.db.platform.execute<{ tenant_id: string }>(query);
    const ids = r.rows.map((x) => x.tenant_id);
    return only ? ids.filter((id) => only.includes(id)) : ids;
  }

  /** One tenant's bad data never blocks the others; the job still fails afterwards so pg-boss retries it. */
  private async perTenant(tenantIds: string[], fn: () => Promise<number>): Promise<number> {
    let total = 0;
    let failed = 0;
    for (const tenantId of tenantIds) {
      try {
        total += await this.db.withTenant(tenantId, null, fn);
      } catch (e) {
        failed++;
        this.logger.error(sanitiseForLog(e, null), `Scheduling job failed for tenant ${tenantId}`);
      }
    }
    if (failed) throw new Error(`Scheduling job failed for ${failed} tenant(s)`);
    return total;
  }
}
