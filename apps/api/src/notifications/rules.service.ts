import { Injectable } from '@nestjs/common';
import { type NotificationRuleDto, RULE_TYPES, type RuleType, type SystemRoleKey, type UpdateNotificationRuleOutput } from '@taskop/contracts';
import { eq, inArray } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { notificationRules, roles } from '../db/schema';
import { effectiveRule, type RoleCatalog, type RuleRow, ruleIssues } from './notification-rules';

/** FR-15.09: the tenant's rules, read and written in the current tenant transaction. */
@Injectable()
export class NotificationRules {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(): Promise<NotificationRuleDto[]> {
    const rows = await this.db.tx().select().from(notificationRules);
    const byType = new Map(rows.map((r) => [r.type, r]));
    const catalog = await this.catalog();
    return RULE_TYPES.map((type) => effectiveRule(type, byType.get(type) ?? null, catalog));
  }

  async effective(type: RuleType): Promise<NotificationRuleDto> {
    return effectiveRule(type, await this.row(type), await this.catalog());
  }

  async update(type: RuleType, input: UpdateNotificationRuleOutput): Promise<NotificationRuleDto> {
    const issues = ruleIssues(type, input);
    if (Object.keys(issues).length) throw new AppError('VALIDATION_FAILED', { fields: issues });
    const tx = this.db.tx();
    if (input.roleIds.length) {
      // RLS hides other tenants' roles, so a foreign id is as unknown as a made-up one.
      const found = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, input.roleIds));
      if (found.length !== input.roleIds.length) throw new AppError('REFERENCE_NOT_FOUND', { fields: { roleIds: 'errors.REFERENCE_NOT_FOUND' } });
    }
    const before = await this.effective(type);
    const { tenantId, userId } = this.db.context();
    const values: RuleRow = {
      enabled: input.enabled,
      push: input.push,
      email: input.email,
      notifyAssignees: input.notifyAssignees,
      notifyCreator: input.notifyCreator,
      roleIds: input.roleIds,
      leadMinutes: input.leadMinutes,
      resultFilter: input.resultFilter,
    };
    const now = this.clock.now();
    await tx
      .insert(notificationRules)
      .values({ tenantId, type, ...values, updatedAt: now, updatedBy: userId })
      .onConflictDoUpdate({ target: [notificationRules.tenantId, notificationRules.type], set: { ...values, updatedAt: now, updatedBy: userId } });
    const after = await this.effective(type);
    await this.audit.record({ action: 'notification_rule.updated', entityType: 'notification_rule', entityId: null, before, after });
    return after;
  }

  /** Back to DEFAULT_RULES. Audited only when there was an override (Spec decision 17). */
  async reset(type: RuleType): Promise<NotificationRuleDto> {
    const before = await this.effective(type);
    const deleted = await this.db
      .tx()
      .delete(notificationRules)
      .where(eq(notificationRules.type, type))
      .returning({ type: notificationRules.type });
    const after = await this.effective(type);
    if (deleted.length) await this.audit.record({ action: 'notification_rule.reset', entityType: 'notification_rule', entityId: null, before, after });
    return after;
  }

  private async row(type: RuleType): Promise<RuleRow | null> {
    const [r] = await this.db.tx().select().from(notificationRules).where(eq(notificationRules.type, type));
    return r ?? null;
  }

  private async catalog(): Promise<RoleCatalog> {
    const rows = await this.db.tx().select({ id: roles.id, systemKey: roles.systemKey }).from(roles);
    const bySystemKey: Partial<Record<SystemRoleKey, string>> = {};
    for (const r of rows) if (r.systemKey) bySystemKey[r.systemKey] = r.id;
    return { bySystemKey, ids: new Set(rows.map((r) => r.id)) };
  }
}
