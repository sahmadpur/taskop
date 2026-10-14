import {
  DEFAULT_RULES,
  type LeadMinutes,
  NOTIFICATION_TYPE_META,
  type NotificationRuleDto,
  type RuleType,
  type UpdateNotificationRuleInput,
} from '@taskop/contracts';

/** A rule row while it is being edited. */
export interface RuleDraft {
  enabled: boolean;
  push: boolean;
  email: boolean;
  notifyAssignees: boolean;
  notifyCreator: boolean;
  roleIds: string[];
  leadMinutes: LeadMinutes | null;
}

export const draftOf = (r: NotificationRuleDto): RuleDraft => ({
  enabled: r.enabled,
  push: r.push,
  email: r.email,
  notifyAssignees: r.notifyAssignees,
  notifyCreator: r.notifyCreator,
  roleIds: [...r.roleIds],
  leadMinutes: r.leadMinutes,
});

/**
 * The full rule PUT /notification-rules/:type expects (Part 1: every field required). Audiences the type does not have
 * are false and the lead time is null unless the type has one, so the API never answers `audienceNotApplicable` or
 * `leadMinutesNotApplicable` for something the user could not see.
 */
export function ruleBody(type: RuleType, d: RuleDraft): UpdateNotificationRuleInput {
  const meta = NOTIFICATION_TYPE_META[type];
  return {
    enabled: d.enabled,
    push: d.push,
    email: d.email,
    notifyAssignees: meta.audiences.includes('assignees') && d.notifyAssignees,
    notifyCreator: meta.audiences.includes('creator') && d.notifyCreator,
    roleIds: [...new Set(d.roleIds)],
    leadMinutes: meta.hasLeadTime ? (d.leadMinutes ?? DEFAULT_RULES[type].leadMinutes) : null,
  };
}

export const sameDraft = (a: RuleDraft, b: RuleDraft): boolean =>
  a.enabled === b.enabled &&
  a.push === b.push &&
  a.email === b.email &&
  a.notifyAssignees === b.notifyAssignees &&
  a.notifyCreator === b.notifyCreator &&
  a.leadMinutes === b.leadMinutes &&
  a.roleIds.length === b.roleIds.length &&
  a.roleIds.every((id) => b.roleIds.includes(id));
