import { Injectable } from '@nestjs/common';
import { currentRequestMeta } from '../common/request-context';
import { DbService } from './db.service';
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

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  /** Writes inside the current tenant transaction, so it commits or rolls back with the change. */
  async record(e: AuditEvent): Promise<void> {
    const { tenantId, userId } = this.db.context();
    const meta = currentRequestMeta();
    await this.db.tx().insert(auditLog).values({
      tenantId,
      actorUserId: e.actorUserId === undefined ? userId : e.actorUserId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: e.before === undefined ? null : redactSecrets(e.before),
      after: e.after === undefined ? null : redactSecrets(e.after),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  async recordAsPlatform(e: AuditEvent & { tenantId: string; actorPlatformAdminId: string }): Promise<void> {
    const meta = currentRequestMeta();
    await this.db.platform.insert(auditLog).values({
      tenantId: e.tenantId,
      actorPlatformAdminId: e.actorPlatformAdminId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: e.before === undefined ? null : redactSecrets(e.before),
      after: e.after === undefined ? null : redactSecrets(e.after),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }
}
