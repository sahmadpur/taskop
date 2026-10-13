import {
  DEFAULT_RULES,
  type LeadMinutes,
  NOTIFICATION_TYPE_META,
  type NotificationIssueCode,
  type NotificationRuleDto,
  type RuleType,
  type SystemRoleKey,
  type UpdateNotificationRuleOutput,
} from '@taskop/contracts';

/** A notification_rules row, as stored. */
export interface RuleRow {
  enabled: boolean;
  push: boolean;
  email: boolean;
  notifyAssignees: boolean;
  notifyCreator: boolean;
  roleIds: string[];
  leadMinutes: number | null;
}

/** The tenant's roles: the built-in ones by key, and every id that exists (roles are never deleted, only deactivated). */
export interface RoleCatalog {
  bySystemKey: Partial<Record<SystemRoleKey, string>>;
  ids: ReadonlySet<string>;
}

/** Spec §3.2: the default, with the tenant row's fields laid over it. Role ids without a role row are dropped. */
export function effectiveRule(type: RuleType, row: RuleRow | null, roles: RoleCatalog): NotificationRuleDto {
  const d = DEFAULT_RULES[type];
  if (!row) {
    return {
      type,
      enabled: d.enabled,
      push: d.push,
      email: d.email,
      notifyAssignees: d.notifyAssignees,
      notifyCreator: d.notifyCreator,
      roleIds: d.systemRoles.map((k) => roles.bySystemKey[k]).filter((id): id is string => id !== undefined),
      leadMinutes: d.leadMinutes,
      isDefault: true,
    };
  }
  return {
    type,
    enabled: row.enabled,
    push: row.push,
    email: row.email,
    notifyAssignees: row.notifyAssignees,
    notifyCreator: row.notifyCreator,
    roleIds: row.roleIds.filter((id) => roles.ids.has(id)),
    // notification_rules_lead_ck keeps a stored value inside LEAD_MINUTES.
    leadMinutes: NOTIFICATION_TYPE_META[type].hasLeadTime ? ((row.leadMinutes as LeadMinutes | null) ?? d.leadMinutes) : null,
    isDefault: false,
  };
}

/** The checks the input schema cannot make without the type (Interfaces: 400 VALIDATION_FAILED with these fields). */
export function ruleIssues(type: RuleType, input: UpdateNotificationRuleOutput): Record<string, NotificationIssueCode> {
  const meta = NOTIFICATION_TYPE_META[type];
  const issues: Record<string, NotificationIssueCode> = {};
  if (meta.hasLeadTime && input.leadMinutes === null) issues.leadMinutes = 'notifications.issues.leadMinutesRequired';
  if (!meta.hasLeadTime && input.leadMinutes !== null) issues.leadMinutes = 'notifications.issues.leadMinutesNotApplicable';
  if (input.notifyAssignees && !meta.audiences.includes('assignees')) issues.notifyAssignees = 'notifications.issues.audienceNotApplicable';
  if (input.notifyCreator && !meta.audiences.includes('creator')) issues.notifyCreator = 'notifications.issues.audienceNotApplicable';
  return issues;
}
