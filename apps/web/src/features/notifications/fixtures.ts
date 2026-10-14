import {
  DEFAULT_RULES,
  type DeliveryCounts,
  type MessageDetail,
  type MessageSummary,
  type MessageTargetOptions,
  type NotificationItem,
  type NotificationRuleDto,
  type RoleDto,
  RULE_TYPES,
  type RuleType,
  type SystemRoleKey,
} from '@taskop/contracts';

/** Test data shared by the notification tests. Not imported by application code. */
export const AT = '2026-11-02T04:00:00.000Z';
export const SENDER = { id: 'mgr', fullName: 'Leyla Quliyeva' };
export const WORKER = { id: 'w1', fullName: 'Nigar Səfərli' };
export const ROLE_IDS: Record<SystemRoleKey, string> = { owner: 'r-own', admin: 'r-adm', manager: 'r-mgr', worker: 'r-wrk', auditor: 'r-aud' };

export const notificationItem = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1',
  type: 'task.assigned',
  title: 'Yeni tapşırıq',
  body: 'Soyuducunun qapısını təmir edin',
  targetKind: 'task',
  targetId: 't1',
  targetDate: null,
  createdAt: AT,
  readAt: null,
  ...over,
});

/** Unread, opens task t1. */
export const taskNote = notificationItem();
/** Unread critical problem of occurrence o1 on 2 November: opens the execution tab. */
export const problemNote = notificationItem({
  id: 'n2',
  type: 'problem.critical',
  title: 'Kritik problem',
  body: 'Anbar №1 · Açılış: Kondisioner xarabdır',
  targetKind: 'occurrence',
  targetId: 'o1',
  targetDate: '2026-11-02',
});
/** A manual message, already read, with no page of its own. */
export const messageNote = notificationItem({
  id: 'n3',
  type: 'manual',
  title: 'Sabah iclas var',
  body: 'Saat 10:00-da ofisdə iclas olacaq.',
  targetKind: 'none',
  targetId: null,
  readAt: '2026-11-02T05:00:00.000Z',
});

/** The effective default of `type`, as GET /notification-rules returns it for a tenant without an override. */
export const ruleDto = (type: RuleType, over: Partial<NotificationRuleDto> = {}): NotificationRuleDto => {
  const d = DEFAULT_RULES[type];
  return {
    type,
    enabled: d.enabled,
    push: d.push,
    email: d.email,
    notifyAssignees: d.notifyAssignees,
    notifyCreator: d.notifyCreator,
    roleIds: d.systemRoles.map((k) => ROLE_IDS[k]),
    leadMinutes: d.leadMinutes,
    isDefault: true,
    ...over,
  };
};

export const allRules = (over: Partial<Record<RuleType, Partial<NotificationRuleDto>>> = {}): NotificationRuleDto[] =>
  RULE_TYPES.map((type) => ruleDto(type, over[type]));

const role = (systemKey: SystemRoleKey): RoleDto => ({
  id: ROLE_IDS[systemKey],
  name: systemKey,
  systemKey,
  dataScope: 'all',
  editable: systemKey !== 'owner',
  active: true,
  permissions: [],
  userCount: 1,
});

/** The five system roles and one inactive custom role. */
export const roleList = (): RoleDto[] => [
  role('owner'),
  role('admin'),
  role('manager'),
  role('worker'),
  role('auditor'),
  { id: 'r-old', name: 'Köhnə rol', systemKey: null, dataScope: 'own', editable: true, active: false, permissions: [], userCount: 0 },
];

export const counts = (over: Partial<DeliveryCounts> = {}): DeliveryCounts => ({ queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0, ...over });

/** Sent to three people: one read it; push delivered to one, failed for one, the third has no phone. */
export const messageSummary = (over: Partial<MessageSummary> = {}): MessageSummary => ({
  id: 'm1',
  title: 'Sabah iclas var',
  body: 'Saat 10:00-da ofisdə iclas olacaq.',
  sender: SENDER,
  sentAt: AT,
  emailRequested: false,
  processed: true,
  recipientCount: 3,
  readCount: 1,
  push: counts({ delivered: 1, failed: 1 }),
  email: counts(),
  ...over,
});

export const messageDetail = (over: Partial<MessageDetail> = {}): MessageDetail => ({
  ...messageSummary(),
  targets: { users: [WORKER], teams: [{ id: 'team1', name: 'Texniki xidmət' }], sites: [] },
  recipients: [
    { user: { id: 'w3', fullName: 'Aysel Məmmədova' }, readAt: null, push: { status: null, devices: 0, lastError: null }, email: { status: null, lastError: null } },
    {
      user: { id: 'w2', fullName: 'Murad Əliyev' },
      readAt: null,
      push: { status: 'failed', devices: 1, lastError: 'DeviceNotRegistered' },
      email: { status: null, lastError: null },
    },
    { user: WORKER, readAt: '2026-11-02T05:00:00.000Z', push: { status: 'delivered', devices: 2, lastError: null }, email: { status: null, lastError: null } },
  ],
  ...over,
});

export const targetOptions = (over: Partial<MessageTargetOptions> = {}): MessageTargetOptions => ({
  users: [
    { id: 'w1', fullName: 'Nigar Səfərli', jobTitle: 'Texnik' },
    { id: 'w2', fullName: 'Murad Əliyev', jobTitle: null },
  ],
  teams: [{ id: 'team1', name: 'Texniki xidmət', memberCount: 3 }],
  sites: [
    { id: 'site1', name: 'Anbar №1' },
    { id: 'site2', name: 'Ofis' },
  ],
  ...over,
});
