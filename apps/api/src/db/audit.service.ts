import { Injectable } from '@nestjs/common';
import { currentRequestMeta } from '../common/request-context';
import { DbService, type Executor } from './db.service';
import { auditLog } from './schema';

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  actorUserId?: string | null;
}

const SECRET_KEY = /hash|secret|password|token|pin/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SECRET_KEY.test(k))
        .map(([k, v]) => [k, redactSecrets(v)]),
    );
  }
  return value;
}

type AuditRow = typeof auditLog.$inferInsert;

function toRow(e: AuditEvent, tenantId: string | null, actorUserId: string | null, actorPlatformAdminId: string | null): AuditRow {
  const meta = currentRequestMeta();
  return {
    tenantId,
    actorUserId,
    actorPlatformAdminId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    before: e.before === undefined ? null : redactSecrets(e.before),
    after: e.after === undefined ? null : redactSecrets(e.after),
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  /** Writes inside the current tenant transaction, so it commits or rolls back with the change. */
  async record(e: AuditEvent): Promise<void> {
    const { tenantId, userId, platformAdminId } = this.db.context();
    const actorUserId = e.actorUserId === undefined ? userId : e.actorUserId;
    await this.db.tx().insert(auditLog).values(toRow(e, tenantId, actorUserId, platformAdminId));
  }

  async recordAsPlatform(e: AuditEvent & { tenantId: string; actorPlatformAdminId: string }): Promise<void> {
    await this.db.platform.insert(auditLog).values(toRow(e, e.tenantId, null, e.actorPlatformAdminId));
  }

  /** Writes on a caller-supplied executor (e.g. a platform-connection transaction for global templates). */
  async recordIn(executor: Executor, e: AuditEvent & { tenantId: string | null; actorPlatformAdminId: string | null }): Promise<void> {
    await executor.insert(auditLog).values(toRow(e, e.tenantId, null, e.actorPlatformAdminId));
  }
}
