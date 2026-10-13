import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { userRefSchema } from './occurrences.js';
import type { SystemRoleKey } from './permissions.js';
import { localDateSchema } from './scheduling-time.js';

/** Spec §3.1. Every notification type; `manual` is an admin message and has no rule. */
export const NOTIFICATION_TYPES = [
  'checklist.assigned',
  'checklist.available',
  'checklist.due_soon',
  'checklist.overdue',
  'checklist.missed',
  'problem.recorded',
  'problem.critical',
  'task.assigned',
  'task.submitted',
  'task.rejected',
  'task.completed',
  'task.overdue',
  'task.cancelled',
  'manual',
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** The types a tenant rule governs (spec §3.2): every type except `manual`, in the same order. */
export const ruleTypeSchema = notificationTypeSchema.exclude(['manual']);
export type RuleType = z.infer<typeof ruleTypeSchema>;
export const RULE_TYPES: readonly RuleType[] = ruleTypeSchema.options;

export const NOTIFICATION_GROUPS = ['checklist', 'problem', 'task'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

/** Direct audiences a rule can switch on. For checklist.assigned, "assignees" means the users just added. */
export const DIRECT_AUDIENCES = ['assignees', 'creator'] as const;
export type DirectAudience = (typeof DIRECT_AUDIENCES)[number];

export interface NotificationTypeMeta {
  group: NotificationGroup;
  /** The direct audiences the settings row shows; others must stay false. */
  audiences: readonly DirectAudience[];
  /** Only checklist.due_soon has a lead time. */
  hasLeadTime: boolean;
}

const checklistMeta = (hasLeadTime = false): NotificationTypeMeta => ({ group: 'checklist', audiences: ['assignees'], hasLeadTime });
const problemMeta: NotificationTypeMeta = { group: 'problem', audiences: [], hasLeadTime: false };
const taskMeta: NotificationTypeMeta = { group: 'task', audiences: ['assignees', 'creator'], hasLeadTime: false };

export const NOTIFICATION_TYPE_META: Record<RuleType, NotificationTypeMeta> = {
  'checklist.assigned': checklistMeta(),
  'checklist.available': checklistMeta(),
  'checklist.due_soon': checklistMeta(true),
  'checklist.overdue': checklistMeta(),
  'checklist.missed': checklistMeta(),
  'problem.recorded': problemMeta,
  'problem.critical': problemMeta,
  'task.assigned': taskMeta,
  'task.submitted': taskMeta,
  'task.rejected': taskMeta,
  'task.completed': taskMeta,
  'task.overdue': taskMeta,
  'task.cancelled': taskMeta,
};

/** FR-15.04: one tenant-wide reminder lead time on the due-soon rule. */
export const LEAD_MINUTES = [15, 30, 60, 120] as const;
export type LeadMinutes = (typeof LEAD_MINUTES)[number];
export const leadMinutesSchema = z.literal([15, 30, 60, 120]);

export type DefaultRule = {
  enabled: boolean;
  push: boolean;
  email: boolean;
  notifyAssignees: boolean;
  notifyCreator: boolean;
  /** Turned into the tenant's role ids by the API (roles.system_key); clients never see this. */
  systemRoles: readonly SystemRoleKey[];
  leadMinutes: LeadMinutes | null;
};

const rule = (
  push: boolean,
  email: boolean,
  notifyAssignees: boolean,
  notifyCreator: boolean,
  systemRoles: readonly SystemRoleKey[] = [],
  leadMinutes: LeadMinutes | null = null,
): DefaultRule => ({ enabled: true, push, email, notifyAssignees, notifyCreator, systemRoles, leadMinutes });

/** Spec §3.1: the rule a tenant has until it saves its own. */
export const DEFAULT_RULES: Record<RuleType, DefaultRule> = {
  'checklist.assigned': rule(true, false, true, false),
  'checklist.available': rule(true, false, true, false),
  'checklist.due_soon': rule(true, false, true, false, [], 30),
  'checklist.overdue': rule(true, false, true, false, ['manager']),
  'checklist.missed': rule(false, false, false, false, ['manager', 'admin']),
  'problem.recorded': rule(true, false, false, false, ['manager']),
  'problem.critical': rule(true, true, false, false, ['manager', 'admin']),
  'task.assigned': rule(true, false, true, false),
  'task.submitted': rule(true, false, false, true),
  'task.rejected': rule(true, false, true, false),
  'task.completed': rule(true, false, false, true),
  'task.overdue': rule(true, false, true, true),
  'task.cancelled': rule(true, false, true, false),
};

/** The web opens a problem notification on the execution tab. */
export const isProblemType = (t: NotificationType): boolean => t.startsWith('problem.');

/** The effective rule (spec §3.2): the default with the tenant's row laid over it. */
export const notificationRuleDtoSchema = z.object({
  type: ruleTypeSchema,
  enabled: z.boolean(),
  push: z.boolean(),
  email: z.boolean(),
  notifyAssignees: z.boolean(),
  notifyCreator: z.boolean(),
  roleIds: z.array(idSchema),
  leadMinutes: leadMinutesSchema.nullable(),
  /** True while the tenant has no override row. */
  isDefault: z.boolean(),
});
export type NotificationRuleDto = z.infer<typeof notificationRuleDtoSchema>;

/** PUT /notification-rules/:type: always the full rule. The API checks audiences and the lead time per type. */
export const updateNotificationRuleSchema = z.object({
  enabled: z.boolean(),
  push: z.boolean(),
  email: z.boolean(),
  notifyAssignees: z.boolean(),
  notifyCreator: z.boolean(),
  roleIds: z
    .array(idSchema)
    .max(50)
    .transform((ids) => [...new Set(ids)]),
  leadMinutes: leadMinutesSchema.nullable(),
});
export type UpdateNotificationRuleInput = z.input<typeof updateNotificationRuleSchema>;
export type UpdateNotificationRuleOutput = z.output<typeof updateNotificationRuleSchema>;

export const NOTIFICATION_TARGET_KINDS = ['occurrence', 'task', 'none'] as const;
export const notificationTargetKindSchema = z.enum(NOTIFICATION_TARGET_KINDS);
export type NotificationTargetKind = z.infer<typeof notificationTargetKindSchema>;

/** One inbox row (FR-25.01). Title and body were rendered at fan-out and never change. */
export const notificationItemSchema = z.object({
  id: idSchema,
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  targetKind: notificationTargetKindSchema,
  targetId: idSchema.nullable(),
  /** The occurrence's local date, for the web schedule link; set only for targetKind 'occurrence'. */
  targetDate: localDateSchema.nullable(),
  createdAt: isoDateTimeSchema,
  readAt: isoDateTimeSchema.nullable(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationListQuerySchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** 'true' = unread only; 'false' or absent = all (Spec decision 14). */
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
export type NotificationListQuery = z.input<typeof notificationListQuerySchema>;

export const unreadCountSchema = z.object({ count: z.number().int().min(0) });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export const pushPlatformSchema = z.enum(PUSH_PLATFORMS);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

export const registerPushDeviceSchema = z.object({
  expoToken: z
    .string()
    .max(200)
    .regex(/^Expo(nent)?PushToken\[.+\]$/),
  platform: pushPlatformSchema,
});
export type RegisterPushDeviceInput = z.input<typeof registerPushDeviceSchema>;

/** The caller's notification preferences; PUT takes the same shape. */
export const preferencesSchema = z.object({ emailNotifications: z.boolean() });
export type Preferences = z.infer<typeof preferencesSchema>;
export const updatePreferencesSchema = preferencesSchema;
export type UpdatePreferencesInput = z.input<typeof updatePreferencesSchema>;

/** The `data` of every push (spec §6.1 step 5). The phone parses it with safeParse. */
export const pushDataSchema = z.object({
  notificationId: idSchema,
  userId: idSchema,
  tenantId: idSchema,
  type: notificationTypeSchema,
  targetKind: notificationTargetKindSchema,
  targetId: idSchema.nullable(),
  targetDate: localDateSchema.nullable(),
});
export type PushData = z.infer<typeof pushDataSchema>;

export const MESSAGE_LIMITS = { titleMax: 80, bodyMax: 500, maxRecipients: 1000, maxTargetsPerKind: 200 } as const;

export const NOTIFICATION_ISSUE_CODES = [
  'notifications.issues.noTargets',
  'notifications.issues.noRecipients',
  'notifications.issues.tooManyRecipients',
  'notifications.issues.leadMinutesRequired',
  'notifications.issues.leadMinutesNotApplicable',
  'notifications.issues.audienceNotApplicable',
] as const;
export type NotificationIssueCode = (typeof NOTIFICATION_ISSUE_CODES)[number];

const targetIds = z.array(idSchema).max(MESSAGE_LIMITS.maxTargetsPerKind).default([]);

/** FR-15.08: a message to users, teams and sites (spec §6.4). */
export const sendMessageSchema = z
  .object({
    title: z.string().trim().min(1).max(MESSAGE_LIMITS.titleMax),
    body: z.string().trim().min(1).max(MESSAGE_LIMITS.bodyMax),
    userIds: targetIds,
    teamIds: targetIds,
    siteIds: targetIds,
    email: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (!v.userIds.length && !v.teamIds.length && !v.siteIds.length) {
      ctx.addIssue({ code: 'custom', path: ['userIds'], message: 'notifications.issues.noTargets' });
    }
  });
export type SendMessageInput = z.input<typeof sendMessageSchema>;

export const messagePreviewSchema = z.object({ recipientCount: z.number().int().min(0) });
export type MessagePreview = z.infer<typeof messagePreviewSchema>;

export const DELIVERY_CHANNELS = ['push', 'email'] as const;
export const deliveryChannelSchema = z.enum(DELIVERY_CHANNELS);
export type DeliveryChannel = z.infer<typeof deliveryChannelSchema>;

export const DELIVERY_STATUSES = ['queued', 'sent', 'delivered', 'failed', 'skipped'] as const;
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/** Best first: a user with one delivered device counts as delivered. */
const AGGREGATE_ORDER: readonly DeliveryStatus[] = ['delivered', 'sent', 'queued', 'failed', 'skipped'];

/** One recipient's status on one channel from all its deliveries; null when there are none. */
export function aggregateDeliveryStatus(statuses: readonly DeliveryStatus[]): DeliveryStatus | null {
  return AGGREGATE_ORDER.find((s) => statuses.includes(s)) ?? null;
}

const count = z.number().int().min(0);
/** Recipients per aggregated status; recipients with no delivery on the channel are not counted. */
export const deliveryCountsSchema = z.object({ queued: count, sent: count, delivered: count, failed: count, skipped: count });
export type DeliveryCounts = z.infer<typeof deliveryCountsSchema>;

export const messageSummarySchema = z.object({
  /** The notification event id. */
  id: idSchema,
  title: z.string(),
  body: z.string(),
  sender: userRefSchema.nullable(),
  sentAt: isoDateTimeSchema,
  emailRequested: z.boolean(),
  /** False while fan-out has not run; every count is then 0. */
  processed: z.boolean(),
  recipientCount: count,
  readCount: count,
  push: deliveryCountsSchema,
  email: deliveryCountsSchema,
});
export type MessageSummary = z.infer<typeof messageSummarySchema>;

export const messageListQuerySchema = cursorQuerySchema;
export type MessageListQuery = z.input<typeof messageListQuerySchema>;

export const messageRecipientSchema = z.object({
  user: userRefSchema,
  readAt: isoDateTimeSchema.nullable(),
  push: z.object({ status: deliveryStatusSchema.nullable(), devices: count, lastError: z.string().nullable() }),
  email: z.object({ status: deliveryStatusSchema.nullable(), lastError: z.string().nullable() }),
});
export type MessageRecipient = z.infer<typeof messageRecipientSchema>;

const namedRefSchema = z.object({ id: idSchema, name: z.string() });

export const messageDetailSchema = messageSummarySchema.extend({
  targets: z.object({ users: z.array(userRefSchema), teams: z.array(namedRefSchema), sites: z.array(namedRefSchema) }),
  /** By full name. */
  recipients: z.array(messageRecipientSchema),
});
export type MessageDetail = z.infer<typeof messageDetailSchema>;

export const messageTargetOptionsQuerySchema = z.object({ q: z.string().trim().max(100).optional() });
export type MessageTargetOptionsQuery = z.input<typeof messageTargetOptionsQuerySchema>;

/** GET /notifications/messages/options: everything inside the caller's data scope (Spec decision 13). */
export const messageTargetOptionsSchema = z.object({
  users: z.array(z.object({ id: idSchema, fullName: z.string(), jobTitle: z.string().nullable() })),
  teams: z.array(z.object({ id: idSchema, name: z.string(), memberCount: count })),
  sites: z.array(namedRefSchema),
});
export type MessageTargetOptions = z.infer<typeof messageTargetOptionsSchema>;
