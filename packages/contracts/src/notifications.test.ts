import { describe, expect, it } from 'vitest';
import {
  aggregateDeliveryStatus,
  ALL_PERMISSIONS,
  DEFAULT_RULES,
  DELIVERY_STATUSES,
  isAuditType,
  isProblemType,
  LEAD_MINUTES,
  leadMinutesSchema,
  MESSAGE_LIMITS,
  messageDetailSchema,
  messageSummarySchema,
  meSchema,
  messageTargetOptionsSchema,
  NOTIFICATION_AUDIT_ACTIONS,
  NOTIFICATION_ISSUE_CODES,
  NOTIFICATION_TYPE_META,
  NOTIFICATION_TYPES,
  notificationItemSchema,
  notificationListQuerySchema,
  notificationRuleDtoSchema,
  PERMISSION_GROUPS,
  preferencesSchema,
  pushDataSchema,
  registerPushDeviceSchema,
  RULE_TYPES,
  sendMessageSchema,
  SYSTEM_ROLE_DEFAULTS,
  syncResponseSchema,
  updateNotificationRuleSchema,
  updatePreferencesSchema,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const ID2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e60';
const AT = '2026-11-02T04:00:00.000Z';
const zero = { queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0 };

describe('notification catalogue', () => {
  it('derives the rule types from the notification types: all but manual, in the same order', () => {
    expect(NOTIFICATION_TYPES).toContain('manual');
    expect(RULE_TYPES).toEqual(NOTIFICATION_TYPES.filter((t) => t !== 'manual'));
    expect(RULE_TYPES).not.toContain('manual');
  });

  it('gives every rule type its meta and its default rule, and nothing else', () => {
    expect(Object.keys(NOTIFICATION_TYPE_META)).toEqual([...RULE_TYPES]);
    expect(Object.keys(DEFAULT_RULES)).toEqual([...RULE_TYPES]);
  });

  it('groups each type by its prefix, the SP8 types under audit, and keeps the lead time on due_soon and the result filter on audit.finished', () => {
    for (const t of RULE_TYPES.filter((x) => !isAuditType(x))) expect(t.startsWith(`${NOTIFICATION_TYPE_META[t].group}.`)).toBe(true);
    expect(RULE_TYPES.filter((t) => NOTIFICATION_TYPE_META[t].group === 'audit')).toEqual(['run.correction_required', 'run.resubmitted', 'audit.finished']);
    expect(RULE_TYPES.filter((t) => NOTIFICATION_TYPE_META[t].hasLeadTime)).toEqual(['checklist.due_soon']);
    expect(RULE_TYPES.filter((t) => NOTIFICATION_TYPE_META[t].hasResultFilter)).toEqual(['audit.finished']);
  });

  it('keeps every default rule inside what its type allows', () => {
    for (const t of RULE_TYPES) {
      const meta = NOTIFICATION_TYPE_META[t];
      const d = DEFAULT_RULES[t];
      expect(d.enabled).toBe(true);
      if (!meta.audiences.includes('assignees')) expect(d.notifyAssignees).toBe(false);
      if (!meta.audiences.includes('creator')) expect(d.notifyCreator).toBe(false);
      expect(d.leadMinutes !== null).toBe(meta.hasLeadTime);
      expect(d.resultFilter !== null).toBe(meta.hasResultFilter);
      if (d.leadMinutes !== null) expect(leadMinutesSchema.safeParse(d.leadMinutes).success).toBe(true);
      // A default that notifies nobody would be a dead rule.
      expect(d.notifyAssignees || d.notifyCreator || d.systemRoles.length > 0 || !d.push).toBe(true);
    }
  });

  it('opens the execution tab for problem types only', () => {
    expect(NOTIFICATION_TYPES.filter(isProblemType)).toEqual(['problem.recorded', 'problem.critical']);
  });
});

describe('rule schemas', () => {
  const base = { enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [ID, ID, ID2], leadMinutes: 60 };

  it('accepts a full rule and removes duplicate role ids', () => {
    expect(updateNotificationRuleSchema.parse(base)).toEqual({ ...base, roleIds: [ID, ID2], resultFilter: null });
    expect(updateNotificationRuleSchema.safeParse({ ...base, leadMinutes: null }).success).toBe(true);
  });

  it('allows only the offered lead times', () => {
    for (const m of LEAD_MINUTES) expect(leadMinutesSchema.parse(m)).toBe(m);
    expect(updateNotificationRuleSchema.safeParse({ ...base, leadMinutes: 45 }).success).toBe(false);
    expect(leadMinutesSchema.safeParse(0).success).toBe(false);
  });

  it('rejects a missing field and too many roles', () => {
    const { email: _e, ...missing } = base;
    expect(updateNotificationRuleSchema.safeParse(missing).success).toBe(false);
    expect(updateNotificationRuleSchema.safeParse({ ...base, roleIds: Array.from({ length: 51 }, () => ID) }).success).toBe(false);
  });

  it('parses the effective rule a client receives, for rule types only', () => {
    const dto = { type: 'checklist.due_soon', ...base, roleIds: [ID], leadMinutes: 30, resultFilter: null, isDefault: false };
    expect(notificationRuleDtoSchema.parse(dto)).toEqual(dto);
    expect(notificationRuleDtoSchema.safeParse({ ...dto, type: 'manual' }).success).toBe(false);
  });
});

describe('inbox schemas', () => {
  it('parses an inbox item', () => {
    const item = { id: ID, type: 'problem.critical', title: 'Kritik problem', body: 'Filial 1', targetKind: 'occurrence', targetId: ID, targetDate: '2026-11-02', createdAt: AT, readAt: null };
    expect(notificationItemSchema.parse(item)).toEqual(item);
    expect(notificationItemSchema.safeParse({ ...item, targetKind: 'site' }).success).toBe(false);
  });

  it('parses the list query: defaults, coercion and bounds', () => {
    expect(notificationListQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(notificationListQuerySchema.parse({ cursor: ID, limit: '100', unread: 'true' })).toEqual({ cursor: ID, limit: 100, unread: true });
    expect(notificationListQuerySchema.parse({ unread: 'false' }).unread).toBe(false);
    expect(notificationListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(notificationListQuerySchema.safeParse({ unread: 'yes' }).success).toBe(false);
  });

  it('accepts Expo push tokens only', () => {
    expect(registerPushDeviceSchema.parse({ expoToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', platform: 'ios' }).platform).toBe('ios');
    expect(registerPushDeviceSchema.safeParse({ expoToken: 'ExpoPushToken[abc]', platform: 'android' }).success).toBe(true);
    expect(registerPushDeviceSchema.safeParse({ expoToken: 'fcm:abc', platform: 'android' }).success).toBe(false);
    expect(registerPushDeviceSchema.safeParse({ expoToken: `ExpoPushToken[${'a'.repeat(200)}]`, platform: 'android' }).success).toBe(false);
    expect(registerPushDeviceSchema.safeParse({ expoToken: 'ExpoPushToken[abc]', platform: 'web' }).success).toBe(false);
  });

  it('reads both preferences and updates any non-empty subset of them', () => {
    expect(preferencesSchema.parse({ emailNotifications: false, locale: 'ru' })).toEqual({ emailNotifications: false, locale: 'ru' });
    expect(preferencesSchema.safeParse({ emailNotifications: false }).success).toBe(false);
    expect(updatePreferencesSchema.parse({ emailNotifications: false })).toEqual({ emailNotifications: false });
    expect(updatePreferencesSchema.parse({ locale: 'en' })).toEqual({ locale: 'en' });
    expect(updatePreferencesSchema.parse({ locale: null })).toEqual({ locale: null });
    expect(updatePreferencesSchema.safeParse({ locale: 'de' }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({}).success).toBe(false);
  });

  it('parses the push data of a notification', () => {
    const data = { notificationId: ID, userId: ID, tenantId: ID, type: 'task.assigned', targetKind: 'task', targetId: ID, targetDate: null };
    expect(pushDataSchema.parse(data)).toEqual(data);
    const manual = { ...data, type: 'manual', targetKind: 'none', targetId: null, targetDate: null };
    expect(pushDataSchema.parse(manual)).toEqual(manual);
    const occurrence = { ...data, type: 'checklist.overdue', targetKind: 'occurrence', targetDate: '2026-11-02' };
    expect(pushDataSchema.parse(occurrence)).toEqual(occurrence);
    expect(pushDataSchema.safeParse({ ...data, targetKind: 'site' }).success).toBe(false);
  });
});

describe('message schemas', () => {
  it('trims, defaults and needs at least one target', () => {
    expect(sendMessageSchema.parse({ title: '  Diqqət ', body: ' Sabah iclas var. ', teamIds: [ID] })).toEqual({
      title: 'Diqqət',
      body: 'Sabah iclas var.',
      userIds: [],
      teamIds: [ID],
      siteIds: [],
      email: false,
    });
    const empty = sendMessageSchema.safeParse({ title: 'a', body: 'b' });
    expect(empty.success).toBe(false);
    expect(empty.error!.issues).toEqual([expect.objectContaining({ path: ['userIds'], message: 'notifications.issues.noTargets' })]);
  });

  it('enforces the message limits at their boundary', () => {
    const ok = { title: 'x'.repeat(MESSAGE_LIMITS.titleMax), body: 'y'.repeat(MESSAGE_LIMITS.bodyMax), userIds: [ID] };
    expect(sendMessageSchema.safeParse(ok).success).toBe(true);
    expect(sendMessageSchema.safeParse({ ...ok, title: 'x'.repeat(MESSAGE_LIMITS.titleMax + 1) }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...ok, body: 'y'.repeat(MESSAGE_LIMITS.bodyMax + 1) }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...ok, title: '   ' }).success).toBe(false);
    const ids = (n: number) => Array.from({ length: n }, () => ID);
    expect(sendMessageSchema.safeParse({ ...ok, siteIds: ids(MESSAGE_LIMITS.maxTargetsPerKind) }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ ...ok, siteIds: ids(MESSAGE_LIMITS.maxTargetsPerKind + 1) }).success).toBe(false);
  });

  it('aggregates a recipient’s deliveries on one channel, best status first', () => {
    expect(aggregateDeliveryStatus([])).toBeNull();
    expect(aggregateDeliveryStatus(['failed', 'delivered'])).toBe('delivered');
    expect(aggregateDeliveryStatus(['failed', 'sent', 'queued'])).toBe('sent');
    expect(aggregateDeliveryStatus(['skipped', 'queued'])).toBe('queued');
    expect(aggregateDeliveryStatus(['skipped', 'failed'])).toBe('failed');
    expect(aggregateDeliveryStatus(['skipped'])).toBe('skipped');
    for (const s of DELIVERY_STATUSES) expect(aggregateDeliveryStatus([s])).toBe(s);
  });

  it('parses summaries, details and picker options', () => {
    const summary = {
      id: ID, title: 'Diqqət', body: 'Sabah iclas var.', sender: { id: ID, fullName: 'Elvin' }, sentAt: AT, emailRequested: true,
      processed: true, recipientCount: 2, readCount: 1, push: { ...zero, delivered: 1, failed: 1 }, email: { ...zero, sent: 2 },
    };
    expect(messageSummarySchema.parse(summary)).toEqual(summary);
    expect(messageSummarySchema.safeParse({ ...summary, push: { delivered: 1 } }).success).toBe(false);
    const detail = {
      ...summary,
      targets: { users: [{ id: ID, fullName: 'Nigar' }], teams: [{ id: ID, name: 'Texniki xidmət' }], sites: [{ id: ID, name: 'Filial 1' }] },
      recipients: [
        { user: { id: ID, fullName: 'Nigar' }, readAt: AT, push: { status: 'failed', devices: 1, lastError: 'DeviceNotRegistered: gone' }, email: { status: null, lastError: null } },
      ],
    };
    expect(messageDetailSchema.parse(detail)).toEqual(detail);
    const options = { users: [{ id: ID, fullName: 'Nigar', jobTitle: null }], teams: [{ id: ID, name: 'Texniki xidmət', memberCount: 2 }], sites: [{ id: ID, name: 'Filial 1' }] };
    expect(messageTargetOptionsSchema.parse(options)).toEqual(options);
  });

  it('names every issue with its full i18n key', () => {
    expect(NOTIFICATION_ISSUE_CODES.length).toBeGreaterThan(0);
    for (const code of NOTIFICATION_ISSUE_CODES) expect(code).toMatch(/^notifications\.issues\.[a-zA-Z]+$/);
    expect(new Set(NOTIFICATION_ISSUE_CODES).size).toBe(NOTIFICATION_ISSUE_CODES.length);
    expect(NOTIFICATION_ISSUE_CODES).toContain('notifications.issues.noTargets');
  });
});

describe('changes to existing contracts', () => {
  it('adds the unread count to the sync response', () => {
    const base = { serverTime: AT, occurrences: [], checklistVersions: [], executions: [], tasks: [], removedTaskIds: [] };
    expect(syncResponseSchema.parse({ ...base, unreadNotifications: 3 }).unreadNotifications).toBe(3);
    expect(syncResponseSchema.safeParse(base).success).toBe(false);
    expect(syncResponseSchema.safeParse({ ...base, unreadNotifications: -1 }).success).toBe(false);
  });

  it('reports the email preference on the profile', () => {
    const me = {
      user: { id: ID, fullName: 'A B', jobTitle: null, kind: 'staff', email: 'a@b.az', username: null, emailVerified: true, credentialKind: 'password', emailNotifications: false, locale: 'en' },
      role: { id: ID, name: 'Owner', systemKey: 'owner', dataScope: 'all' },
      permissions: [],
      tenant: { id: ID, name: 'Acme', orgCode: 'acme', timezone: 'Asia/Baku', locale: 'az' },
    };
    expect(meSchema.parse(me).user).toMatchObject({ emailNotifications: false, locale: 'en' });
  });

  it('adds the notification permissions, with the role defaults', () => {
    expect(PERMISSION_GROUPS.find((g) => g.group === 'notifications')).toEqual({ group: 'notifications', keys: ['notifications.manage', 'notifications.send'] });
    expect(SYSTEM_ROLE_DEFAULTS.owner.permissions).toEqual(expect.arrayContaining(['notifications.manage', 'notifications.send']));
    expect(SYSTEM_ROLE_DEFAULTS.admin.permissions).toEqual(expect.arrayContaining(['notifications.manage', 'notifications.send']));
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).toContain('notifications.send');
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).not.toContain('notifications.manage');
    expect(SYSTEM_ROLE_DEFAULTS.worker.permissions).toEqual([]);
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions.filter((k) => k.startsWith('notifications.'))).toEqual([]);
    expect(ALL_PERMISSIONS.filter((k) => k.startsWith('notifications.'))).toEqual(['notifications.manage', 'notifications.send']);
  });

  it('lists the audited notification actions', () => {
    expect(NOTIFICATION_AUDIT_ACTIONS).toEqual(['notification_rule.updated', 'notification_rule.reset', 'notification.message_sent']);
  });
});
