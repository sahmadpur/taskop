import { Injectable } from '@nestjs/common';
import type { AuditEntryDto, Page } from '@taskop/contracts';
import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DbService } from '../db/db.service';
import { auditLog, users } from '../db/schema';
import type { AuditListQueryDto } from './dto';

const actor = alias(users, 'actor');

@Injectable()
export class AuditLogService {
  constructor(private readonly db: DbService) {}

  async list(q: AuditListQueryDto): Promise<Page<AuditEntryDto>> {
    const conditions: (SQL | undefined)[] = [];
    if (q.actorUserId) conditions.push(eq(auditLog.actorUserId, q.actorUserId));
    if (q.action) conditions.push(eq(auditLog.action, q.action));
    if (q.entityType) conditions.push(eq(auditLog.entityType, q.entityType));
    if (q.entityId) conditions.push(eq(auditLog.entityId, q.entityId));
    if (q.from) conditions.push(gte(auditLog.occurredAt, new Date(q.from)));
    if (q.to) conditions.push(lte(auditLog.occurredAt, new Date(q.to)));
    if (q.cursor) conditions.push(lt(auditLog.id, q.cursor));
    const rows = await this.db
      .tx()
      .select({ entry: auditLog, actorName: actor.fullName })
      .from(auditLog)
      .leftJoin(actor, eq(actor.id, auditLog.actorUserId))
      .where(and(...conditions))
      .orderBy(desc(auditLog.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(({ entry, actorName }): AuditEntryDto => ({
      id: entry.id,
      actor: entry.actorPlatformAdminId
        ? { type: 'platform_admin', id: entry.actorPlatformAdminId, name: null }
        : entry.actorUserId
          ? { type: 'user', id: entry.actorUserId, name: actorName }
          : { type: 'system', id: null, name: null },
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip,
      occurredAt: entry.occurredAt.toISOString(),
    }));
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }
}
