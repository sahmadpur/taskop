import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  date,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { citext, ltree } from './column-types';

export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);
export const userKind = pgEnum('user_kind', ['worker', 'staff']);
export const userStatus = pgEnum('user_status', ['active', 'deactivated', 'invited']);
export const credentialKind = pgEnum('credential_kind', ['password', 'pin']);
export const dataScope = pgEnum('data_scope', ['all', 'site_subtree', 'subordinates', 'own']);
export const systemRoleKey = pgEnum('system_role_key', ['owner', 'admin', 'manager', 'worker', 'auditor']);
export const sessionClient = pgEnum('session_client', ['web', 'mobile']);
export const authTokenPurpose = pgEnum('auth_token_purpose', ['email_verify', 'invite', 'password_reset']);

const id = () => uuid('id').primaryKey().$defaultFn(() => uuidv7());
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  orgCode: text('org_code').notNull().unique('tenants_org_code_uq'),
  timezone: text('timezone').notNull().default('Asia/Baku'),
  locale: text('locale').notNull().default('az'),
  status: tenantStatus('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const siteTypes = pgTable(
  'site_types',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique('site_types_tenant_id_uq').on(t.tenantId, t.id)],
);

export const sites = pgTable(
  'sites',
  {
    id: id(),
    tenantId: tenantId(),
    parentId: uuid('parent_id'),
    typeId: uuid('type_id').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    active: boolean('active').notNull().default(true),
    path: ltree('path').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('sites_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.parentId], foreignColumns: [t.tenantId, t.id], name: 'sites_parent_fk' }),
    foreignKey({ columns: [t.tenantId, t.typeId], foreignColumns: [siteTypes.tenantId, siteTypes.id], name: 'sites_type_fk' }),
    index('sites_path_gist').using('gist', t.path),
    index('sites_tenant_idx').on(t.tenantId),
  ],
);

export const teams = pgTable(
  'teams',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('teams_tenant_id_uq').on(t.tenantId, t.id)],
);

export const roles = pgTable(
  'roles',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    systemKey: systemRoleKey('system_key'),
    dataScope: dataScope('data_scope').notNull(),
    editable: boolean('editable').notNull().default(true),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('roles_tenant_id_uq').on(t.tenantId, t.id), unique('roles_tenant_system_key_uq').on(t.tenantId, t.systemKey)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    tenantId: tenantId(),
    roleId: uuid('role_id').notNull(),
    permissionKey: text('permission_key').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionKey] }),
    foreignKey({ columns: [t.tenantId, t.roleId], foreignColumns: [roles.tenantId, roles.id], name: 'role_permissions_role_fk' }),
  ],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: tenantId(),
    fullName: text('full_name').notNull(),
    jobTitle: text('job_title'),
    managerId: uuid('manager_id'),
    roleId: uuid('role_id').notNull(),
    kind: userKind('kind').notNull(),
    email: citext('email').unique('users_email_uq'),
    username: text('username'),
    phone: text('phone'),
    credentialHash: text('credential_hash'),
    credentialKind: credentialKind('credential_kind'),
    emailVerifiedAt: ts('email_verified_at'),
    lastLoginAt: ts('last_login_at'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    totpSecretEnc: text('totp_secret_enc'),
    // B-12: the only per-user notification switch (SP6 spec §5).
    emailNotifications: boolean('email_notifications').notNull().default(true),
    // The language of server-generated text for this user; null = the tenant's locale.
    locale: text('locale'),
    status: userStatus('status').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('users_tenant_id_uq').on(t.tenantId, t.id),
    unique('users_tenant_username_uq').on(t.tenantId, t.username),
    foreignKey({ columns: [t.tenantId, t.managerId], foreignColumns: [t.tenantId, t.id], name: 'users_manager_fk' }),
    foreignKey({ columns: [t.tenantId, t.roleId], foreignColumns: [roles.tenantId, roles.id], name: 'users_role_fk' }),
    check('users_username_lower', sql`${t.username} = lower(${t.username})`),
    check('users_locale_ck', sql`${t.locale} in ('az', 'en', 'ru')`),
    check(
      'users_kind_identity',
      sql`(${t.kind} = 'staff' and ${t.email} is not null) or (${t.kind} = 'worker' and ${t.username} is not null)`,
    ),
    index('users_tenant_idx').on(t.tenantId),
  ],
);

export const userTeams = pgTable(
  'user_teams',
  {
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    teamId: uuid('team_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.teamId] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'user_teams_user_fk' }),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id], name: 'user_teams_team_fk' }),
  ],
);

export const userSites = pgTable(
  'user_sites',
  {
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    siteId: uuid('site_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.siteId] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'user_sites_user_fk' }),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'user_sites_site_fk' }),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    familyId: uuid('family_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique('sessions_refresh_token_hash_uq'),
    client: sessionClient('client').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    replacedBy: uuid('replaced_by'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'sessions_user_fk' }),
    index('sessions_user_idx').on(t.userId),
    index('sessions_family_idx').on(t.familyId),
  ],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    purpose: authTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique('auth_tokens_token_hash_uq'),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'auth_tokens_user_fk' })],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    // null only for platform-scope entries (global templates); see audit_log_scope_ck.
    tenantId: uuid('tenant_id').references(() => tenants.id),
    actorUserId: uuid('actor_user_id'),
    actorPlatformAdminId: uuid('actor_platform_admin_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_tenant_time_idx').on(t.tenantId, t.occurredAt),
    check('audit_log_scope_ck', sql`${t.tenantId} is not null or ${t.actorPlatformAdminId} is not null`),
  ],
);

export const platformAdmins = pgTable('platform_admins', {
  id: id(),
  email: citext('email').notNull().unique('platform_admins_email_uq'),
  credentialHash: text('credential_hash').notNull(),
  fullName: text('full_name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export const checklistStatus = pgEnum('checklist_status', ['active', 'deactivated']);
export const checklistVersionState = pgEnum('checklist_version_state', ['draft', 'published']);
// Must match TEMPLATE_CATEGORIES in @taskop/contracts.
export const templateCategory = pgEnum('template_category', ['cleaning', 'restaurant', 'retail', 'safety', 'production', 'warehouse', 'quality', 'maintenance', 'other']);
export const templateSourceKind = pgEnum('template_source_kind', ['global', 'tenant']);

const createdByUser = () => uuid('created_by_user_id');
const createdByPlatform = () => uuid('created_by_platform_admin_id');
const oneCreator = (name: string, t: { createdByUserId: AnyPgColumn; createdByPlatformAdminId: AnyPgColumn }) =>
  check(name, sql`num_nonnulls(${t.createdByUserId}, ${t.createdByPlatformAdminId}) = 1`);

export const checklists = pgTable(
  'checklists',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    category: templateCategory('category'),
    status: checklistStatus('status').notNull().default('active'),
    // FK to checklist_versions (tenant_id, id) is added in 0004 (circular reference).
    currentVersionId: uuid('current_version_id'),
    latestVersionNumber: integer('latest_version_number').notNull().default(0),
    sourceTemplateKind: templateSourceKind('source_template_kind'),
    sourceTemplateId: uuid('source_template_id'),
    sourceVersionId: uuid('source_version_id'),
    // SP8 spec §4.1: settings, not versioned content.
    requiresAudit: boolean('requires_audit').notNull().default(false),
    auditReportEmails: text('audit_report_emails').array().notNull().default(sql`'{}'::text[]`),
    createdByUserId: createdByUser(),
    createdByPlatformAdminId: createdByPlatform(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('checklists_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.createdByUserId], foreignColumns: [users.tenantId, users.id], name: 'checklists_created_by_fk' }),
    oneCreator('checklists_creator_ck', t),
    index('checklists_tenant_idx').on(t.tenantId, t.id),
  ],
);

export const checklistVersions = pgTable(
  'checklist_versions',
  {
    id: id(),
    tenantId: tenantId(),
    checklistId: uuid('checklist_id').notNull(),
    state: checklistVersionState('state').notNull(),
    number: integer('number'),
    content: jsonb('content').notNull(),
    changeNote: text('change_note'),
    revision: integer('revision').notNull().default(1),
    createdByUserId: createdByUser(),
    createdByPlatformAdminId: createdByPlatform(),
    publishedByUserId: uuid('published_by_user_id'),
    publishedByPlatformAdminId: uuid('published_by_platform_admin_id'),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('checklist_versions_tenant_id_uq').on(t.tenantId, t.id),
    unique('checklist_versions_number_uq').on(t.checklistId, t.number),
    uniqueIndex('checklist_versions_one_draft_uq').on(t.checklistId).where(sql`${t.state} = 'draft'`),
    foreignKey({ columns: [t.tenantId, t.checklistId], foreignColumns: [checklists.tenantId, checklists.id], name: 'checklist_versions_checklist_fk' }),
    foreignKey({ columns: [t.tenantId, t.createdByUserId], foreignColumns: [users.tenantId, users.id], name: 'checklist_versions_created_by_fk' }),
    foreignKey({ columns: [t.tenantId, t.publishedByUserId], foreignColumns: [users.tenantId, users.id], name: 'checklist_versions_published_by_fk' }),
    oneCreator('checklist_versions_creator_ck', t),
    check(
      'checklist_versions_published_ck',
      sql`(${t.state} = 'draft' and ${t.number} is null and ${t.publishedAt} is null and ${t.publishedByUserId} is null and ${t.publishedByPlatformAdminId} is null)
       or (${t.state} = 'published' and ${t.number} is not null and ${t.publishedAt} is not null and num_nonnulls(${t.publishedByUserId}, ${t.publishedByPlatformAdminId}) = 1)`,
    ),
    index('checklist_versions_checklist_idx').on(t.tenantId, t.checklistId),
  ],
);

export const tenantTemplates = pgTable(
  'tenant_templates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    category: templateCategory('category').notNull(),
    content: jsonb('content').notNull(),
    revision: integer('revision').notNull().default(1),
    itemCount: integer('item_count').notNull(),
    status: checklistStatus('status').notNull().default('active'),
    sourceChecklistId: uuid('source_checklist_id'),
    sourceVersionId: uuid('source_version_id'),
    createdByUserId: createdByUser(),
    createdByPlatformAdminId: createdByPlatform(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('tenant_templates_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.createdByUserId], foreignColumns: [users.tenantId, users.id], name: 'tenant_templates_created_by_fk' }),
    oneCreator('tenant_templates_creator_ck', t),
    index('tenant_templates_tenant_idx').on(t.tenantId),
  ],
);

/** Taskop's library. No tenant_id and no RLS: tenants read it only through `global_templates_published`. */
export const globalTemplates = pgTable('global_templates', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  category: templateCategory('category').notNull(),
  content: jsonb('content').notNull(),
  revision: integer('revision').notNull().default(1),
  itemCount: integer('item_count').notNull(),
  published: boolean('published').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  // null = inserted by the seed script.
  createdByPlatformAdminId: uuid('created_by_platform_admin_id').references(() => platformAdmins.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Created by hand in 0004 (drizzle-kit does not manage it). */
export const globalTemplatesPublished = pgView('global_templates_published', {
  id: uuid('id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: templateCategory('category').notNull(),
  content: jsonb('content').notNull(),
  revision: integer('revision').notNull(),
  itemCount: integer('item_count').notNull(),
  sortOrder: integer('sort_order').notNull(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
}).existing();

export const assignmentStatus = pgEnum('assignment_status', ['active', 'paused', 'ended']);
// Must match OCCURRENCE_STATUSES in @taskop/contracts (FR-11.01).
export const occurrenceStatus = pgEnum('occurrence_status', [
  'pending',
  'started',
  'in_progress',
  'completed',
  'partial',
  'overdue',
  'missed',
  'cancelled',
  'audit_pending',
  'audited',
  'correction_required',
]);

const localDate = (name: string) => date(name, { mode: 'string' });

export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    // null = usable at every site.
    siteId: uuid('site_id'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('shifts_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'shifts_site_fk' }),
    check('shifts_nonzero_ck', sql`${t.startTime} <> ${t.endTime}`),
    index('shifts_tenant_idx').on(t.tenantId),
  ],
);

export const shiftRoster = pgTable(
  'shift_roster',
  {
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    siteId: uuid('site_id').notNull(),
    // Local date the shift starts.
    date: localDate('date').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.shiftId, t.siteId, t.date] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'shift_roster_user_fk' }),
    foreignKey({ columns: [t.tenantId, t.shiftId], foreignColumns: [shifts.tenantId, shifts.id], name: 'shift_roster_shift_fk' }),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'shift_roster_site_fk' }),
    index('shift_roster_site_date_idx').on(t.tenantId, t.siteId, t.date),
  ],
);

export const assignments = pgTable(
  'assignments',
  {
    id: id(),
    tenantId: tenantId(),
    checklistId: uuid('checklist_id').notNull(),
    siteId: uuid('site_id').notNull(),
    name: text('name'),
    schedule: jsonb('schedule').notNull(),
    timing: jsonb('timing').notNull(),
    // Copied from timing.shiftId for FKs and queries.
    shiftId: uuid('shift_id'),
    status: assignmentStatus('status').notNull().default('active'),
    revision: integer('revision').notNull().default(1),
    // Every slot starting at or before this instant has been considered (spec §5.1).
    materializedUntil: ts('materialized_until'),
    createdByUserId: createdByUser(),
    createdByPlatformAdminId: createdByPlatform(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('assignments_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.checklistId], foreignColumns: [checklists.tenantId, checklists.id], name: 'assignments_checklist_fk' }),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'assignments_site_fk' }),
    foreignKey({ columns: [t.tenantId, t.shiftId], foreignColumns: [shifts.tenantId, shifts.id], name: 'assignments_shift_fk' }),
    foreignKey({ columns: [t.tenantId, t.createdByUserId], foreignColumns: [users.tenantId, users.id], name: 'assignments_created_by_fk' }),
    oneCreator('assignments_creator_ck', t),
    index('assignments_site_idx').on(t.tenantId, t.siteId),
    index('assignments_checklist_idx').on(t.tenantId, t.checklistId),
  ],
);

export const assignmentAssignees = pgTable(
  'assignment_assignees',
  {
    tenantId: tenantId(),
    assignmentId: uuid('assignment_id').notNull(),
    userId: uuid('user_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assignmentId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.assignmentId], foreignColumns: [assignments.tenantId, assignments.id], name: 'assignment_assignees_assignment_fk' }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'assignment_assignees_user_fk' }),
    index('assignment_assignees_user_idx').on(t.tenantId, t.userId),
  ],
);

export const occurrences = pgTable(
  'occurrences',
  {
    id: id(),
    tenantId: tenantId(),
    assignmentId: uuid('assignment_id').notNull(),
    checklistId: uuid('checklist_id').notNull(),
    siteId: uuid('site_id').notNull(),
    shiftId: uuid('shift_id'),
    localDate: localDate('local_date').notNull(),
    startsAt: ts('starts_at').notNull(),
    dueAt: ts('due_at').notNull(),
    closesAt: ts('closes_at').notNull(),
    status: occurrenceStatus('status').notNull().default('pending'),
    statusChangedAt: ts('status_changed_at').notNull().defaultNow(),
    cancelReason: text('cancel_reason'),
    // Pinned at the first download by an assignee or at the claim, then never changed (SP4 spec §5.1).
    checklistVersionId: uuid('checklist_version_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('occurrences_tenant_id_uq').on(t.tenantId, t.id),
    // One live occurrence per assignment and day; cancelled ones never block a regenerated slot.
    uniqueIndex('occurrences_live_day_uq').on(t.assignmentId, t.localDate).where(sql`status <> 'cancelled'`),
    foreignKey({ columns: [t.tenantId, t.assignmentId], foreignColumns: [assignments.tenantId, assignments.id], name: 'occurrences_assignment_fk' }),
    foreignKey({ columns: [t.tenantId, t.checklistId], foreignColumns: [checklists.tenantId, checklists.id], name: 'occurrences_checklist_fk' }),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'occurrences_site_fk' }),
    foreignKey({ columns: [t.tenantId, t.shiftId], foreignColumns: [shifts.tenantId, shifts.id], name: 'occurrences_shift_fk' }),
    foreignKey({ columns: [t.tenantId, t.checklistVersionId], foreignColumns: [checklistVersions.tenantId, checklistVersions.id], name: 'occurrences_version_fk' }),
    check('occurrences_window_ck', sql`${t.startsAt} <= ${t.dueAt} and ${t.dueAt} <= ${t.closesAt}`),
    index('occurrences_site_start_idx').on(t.tenantId, t.siteId, t.startsAt),
    index('occurrences_status_due_idx').on(t.tenantId, t.status, t.dueAt),
    index('occurrences_status_close_idx').on(t.tenantId, t.status, t.closesAt),
    index('occurrences_assignment_start_idx').on(t.tenantId, t.assignmentId, t.startsAt),
    // Every report filters runs by their tenant-local day (SP7 spec §5.7).
    index('occurrences_local_date_idx').on(t.tenantId, t.localDate),
  ],
);

export const occurrenceAssignees = pgTable(
  'occurrence_assignees',
  {
    tenantId: tenantId(),
    occurrenceId: uuid('occurrence_id').notNull(),
    userId: uuid('user_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.occurrenceId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.occurrenceId], foreignColumns: [occurrences.tenantId, occurrences.id], name: 'occurrence_assignees_occurrence_fk' }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'occurrence_assignees_user_fk' }),
    index('occurrence_assignees_user_idx').on(t.tenantId, t.userId),
  ],
);

/** Append-only (FR-11.02): the app account may only INSERT and SELECT. */
export const occurrenceStatusHistory = pgTable(
  'occurrence_status_history',
  {
    id: id(),
    tenantId: tenantId(),
    occurrenceId: uuid('occurrence_id').notNull(),
    fromStatus: occurrenceStatus('from_status'),
    toStatus: occurrenceStatus('to_status').notNull(),
    at: ts('at').notNull(),
    // Both null = the system (jobs).
    actorUserId: uuid('actor_user_id'),
    actorPlatformAdminId: uuid('actor_platform_admin_id'),
    reason: text('reason'),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.occurrenceId], foreignColumns: [occurrences.tenantId, occurrences.id], name: 'occurrence_status_history_occurrence_fk' }),
    index('occurrence_status_history_occurrence_idx').on(t.tenantId, t.occurrenceId, t.at),
  ],
);

// Must match EXECUTION_STATES, CLAIM_REJECTION_REASONS, MEDIA_*, PROBLEM_SOURCES and PROBLEM_SEVERITIES in @taskop/contracts.
export const executionState = pgEnum('execution_state', ['active', 'completed', 'partial', 'rejected', 'rework']);
export const claimRejectionReason = pgEnum('claim_rejection_reason', ['ALREADY_CLAIMED', 'NOT_ASSIGNED', 'NOT_STARTABLE', 'NOT_YET_OPEN', 'CLOSED', 'NOT_ON_SHIFT']);
export const mediaKind = pgEnum('media_kind', ['photo', 'video']);
export const mediaSource = pgEnum('media_source', ['camera', 'gallery']);
export const mediaStatus = pgEnum('media_status', ['pending', 'uploaded']);
export const problemSource = pgEnum('problem_source', ['rule', 'manual']);
export const problemSeverity = pgEnum('problem_severity', ['normal', 'critical']);
// Must match CORRECTION_KINDS in @taskop/contracts.
export const correctionKind = pgEnum('correction_kind', ['manual', 'rework']);

/** One attempt to execute an occurrence (SP4 spec §5.2). The id is generated on the phone, so every command is idempotent. */
export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey(),
    tenantId: tenantId(),
    occurrenceId: uuid('occurrence_id').notNull(),
    checklistVersionId: uuid('checklist_version_id').notNull(),
    executorUserId: uuid('executor_user_id').notNull(),
    state: executionState('state').notNull(),
    rejectedReason: claimRejectionReason('rejected_reason'),
    // Device times (after bounds), with the server receipt times beside them (BR-11).
    startedAt: ts('started_at').notNull(),
    startedReceivedAt: ts('started_received_at').notNull(),
    completedAt: ts('completed_at'),
    completedReceivedAt: ts('completed_received_at'),
    lastSyncedAt: ts('last_synced_at').notNull(),
    answers: jsonb('answers').notNull().default({}),
    answersRev: integer('answers_rev').notNull().default(0),
    progress: jsonb('progress').notNull(),
    score: jsonb('score'),
    late: boolean('late').notNull().default(false),
    clockOffsetMs: integer('clock_offset_ms'),
    clockSuspect: boolean('clock_suspect').notNull().default(false),
    device: jsonb('device').notNull(),
    // The one-time snapshot taken by the first correction or send-back (SP8 spec §4.1); a trigger keeps it immutable.
    originalAnswers: jsonb('original_answers'),
    originalScore: jsonb('original_score'),
    originalCapturedAt: ts('original_captured_at'),
    // Send-back rounds so far.
    reworkRound: integer('rework_round').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('executions_tenant_id_uq').on(t.tenantId, t.id),
    // The claim lock (FR-09.11, BR-13): one counted execution per occurrence; rejected ones are kept beside it.
    uniqueIndex('executions_claim_uq').on(t.occurrenceId).where(sql`state <> 'rejected'`),
    foreignKey({ columns: [t.tenantId, t.occurrenceId], foreignColumns: [occurrences.tenantId, occurrences.id], name: 'executions_occurrence_fk' }),
    foreignKey({ columns: [t.tenantId, t.checklistVersionId], foreignColumns: [checklistVersions.tenantId, checklistVersions.id], name: 'executions_version_fk' }),
    foreignKey({ columns: [t.tenantId, t.executorUserId], foreignColumns: [users.tenantId, users.id], name: 'executions_executor_fk' }),
    check('executions_rejected_ck', sql`(${t.state} = 'rejected') = (${t.rejectedReason} is not null)`),
    index('executions_executor_idx').on(t.tenantId, t.executorUserId, t.startedAt),
    index('executions_occurrence_idx').on(t.tenantId, t.occurrenceId),
  ],
);

/** Photos and videos (FR-12). The file itself lives in object storage under storage_key. */
export const executionMedia = pgTable(
  'execution_media',
  {
    id: uuid('id').primaryKey(),
    tenantId: tenantId(),
    executionId: uuid('execution_id').notNull(),
    // null = attached only to a manual problem.
    itemId: uuid('item_id'),
    kind: mediaKind('kind').notNull(),
    source: mediaSource('source').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    capturedAt: ts('captured_at').notNull(),
    capturedByUserId: uuid('captured_by_user_id').notNull(),
    storageKey: text('storage_key').notNull(),
    status: mediaStatus('status').notNull().default('pending'),
    uploadedAt: ts('uploaded_at'),
    // Set by media.cleanup when it deleted the object of a never-uploaded medium.
    storagePurgedAt: ts('storage_purged_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('execution_media_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.executionId], foreignColumns: [executions.tenantId, executions.id], name: 'execution_media_execution_fk' }),
    foreignKey({ columns: [t.tenantId, t.capturedByUserId], foreignColumns: [users.tenantId, users.id], name: 'execution_media_captured_by_fk' }),
    index('execution_media_execution_idx').on(t.tenantId, t.executionId),
    index('execution_media_status_idx').on(t.tenantId, t.status, t.createdAt),
  ],
);

/** Append-only (BR-14, FR-19.13): one row per changed item. The app account may only INSERT and SELECT. */
export const executionCorrections = pgTable(
  'execution_corrections',
  {
    id: id(),
    tenantId: tenantId(),
    executionId: uuid('execution_id').notNull(),
    itemId: uuid('item_id').notNull(),
    kind: correctionKind('kind').notNull(),
    // executions.rework_round at the time: 0 for a manual correction before any send-back.
    round: integer('round').notNull(),
    // The item's whole answer before and after, or null.
    before: jsonb('before'),
    after: jsonb('after'),
    // manual: the manager's reason; rework: the manager's comment on the item.
    reason: text('reason').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorPlatformAdminId: uuid('actor_platform_admin_id'),
    at: ts('at').notNull(),
  },
  (t) => [
    unique('execution_corrections_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.executionId], foreignColumns: [executions.tenantId, executions.id], name: 'execution_corrections_execution_fk' }),
    foreignKey({ columns: [t.tenantId, t.actorUserId], foreignColumns: [users.tenantId, users.id], name: 'execution_corrections_actor_fk' }),
    check('execution_corrections_actor_ck', sql`num_nonnulls(${t.actorUserId}, ${t.actorPlatformAdminId}) = 1`),
    index('execution_corrections_execution_idx').on(t.tenantId, t.executionId, t.at),
  ],
);

/** Rule and manual problems of counted executions (FR-13), derived from the answers; frozen once the execution closes. */
export const executionProblems = pgTable(
  'execution_problems',
  {
    id: id(),
    tenantId: tenantId(),
    executionId: uuid('execution_id').notNull(),
    occurrenceId: uuid('occurrence_id').notNull(),
    siteId: uuid('site_id').notNull(),
    checklistId: uuid('checklist_id').notNull(),
    itemId: uuid('item_id').notNull(),
    source: problemSource('source').notNull(),
    severity: problemSeverity('severity').notNull(),
    note: text('note'),
    mediaIds: uuid('media_ids').array().notNull().default(sql`'{}'::uuid[]`),
    // A correction after close removed it (SP8 spec §4.1): the row stays, so a task made from it keeps its link.
    clearedAt: ts('cleared_at'),
    clearedByCorrectionId: uuid('cleared_by_correction_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The target of tasks_problem_fk (composite, like every tenant-scoped reference).
    unique('execution_problems_tenant_id_uq').on(t.tenantId, t.id),
    // One active problem per item and source; a cleared row and a new active row may coexist.
    uniqueIndex('execution_problems_active_item_uq').on(t.executionId, t.itemId, t.source).where(sql`cleared_at is null`),
    foreignKey({
      columns: [t.tenantId, t.clearedByCorrectionId],
      foreignColumns: [executionCorrections.tenantId, executionCorrections.id],
      name: 'execution_problems_cleared_by_fk',
    }),
    foreignKey({ columns: [t.tenantId, t.executionId], foreignColumns: [executions.tenantId, executions.id], name: 'execution_problems_execution_fk' }),
    foreignKey({ columns: [t.tenantId, t.occurrenceId], foreignColumns: [occurrences.tenantId, occurrences.id], name: 'execution_problems_occurrence_fk' }),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'execution_problems_site_fk' }),
    foreignKey({ columns: [t.tenantId, t.checklistId], foreignColumns: [checklists.tenantId, checklists.id], name: 'execution_problems_checklist_fk' }),
    index('execution_problems_site_idx').on(t.tenantId, t.siteId, t.createdAt),
    index('execution_problems_severity_idx').on(t.tenantId, t.severity, t.createdAt),
  ],
);

/** A send-back (SP8 spec §4.2). Open while both resubmitted_at and withdrawn_at are null. */
export const executionReworkRequests = pgTable(
  'execution_rework_requests',
  {
    id: id(),
    tenantId: tenantId(),
    executionId: uuid('execution_id').notNull(),
    round: integer('round').notNull(),
    // [{ itemId, comment }]
    items: jsonb('items').notNull(),
    dueAt: ts('due_at'),
    requestedByUserId: uuid('requested_by_user_id'),
    requestedByPlatformAdminId: uuid('requested_by_platform_admin_id'),
    requestedAt: ts('requested_at').notNull(),
    // The answers when the run was sent back: the base of the rework guard and of the rework corrections.
    answersBefore: jsonb('answers_before').notNull(),
    // completed or audit_pending; restored when the send-back is withdrawn.
    statusBefore: occurrenceStatus('status_before').notNull(),
    resubmittedAt: ts('resubmitted_at'),
    withdrawnAt: ts('withdrawn_at'),
    withdrawnByUserId: uuid('withdrawn_by_user_id'),
  },
  (t) => [
    unique('execution_rework_requests_tenant_id_uq').on(t.tenantId, t.id),
    unique('execution_rework_requests_round_uq').on(t.executionId, t.round),
    uniqueIndex('execution_rework_requests_open_uq').on(t.executionId).where(sql`resubmitted_at is null and withdrawn_at is null`),
    foreignKey({ columns: [t.tenantId, t.executionId], foreignColumns: [executions.tenantId, executions.id], name: 'execution_rework_requests_execution_fk' }),
    foreignKey({ columns: [t.tenantId, t.requestedByUserId], foreignColumns: [users.tenantId, users.id], name: 'execution_rework_requests_requested_by_fk' }),
    foreignKey({ columns: [t.tenantId, t.withdrawnByUserId], foreignColumns: [users.tenantId, users.id], name: 'execution_rework_requests_withdrawn_by_fk' }),
    check('execution_rework_requests_requester_ck', sql`num_nonnulls(${t.requestedByUserId}, ${t.requestedByPlatformAdminId}) = 1`),
    check('execution_rework_requests_status_before_ck', sql`${t.statusBefore} in ('completed', 'audit_pending')`),
  ],
);

// Must match TASK_STATUSES, TASK_PRIORITIES, TASK_MEDIA_ROLES and TASK_REVIEW_DECISIONS in @taskop/contracts.
export const taskStatus = pgEnum('task_status', ['new', 'accepted', 'in_progress', 'awaiting_review', 'completed', 'cancelled']);
export const taskPriority = pgEnum('task_priority', ['normal', 'high']);
export const taskMediaRole = pgEnum('task_media_role', ['instruction', 'response']);
export const taskReviewDecision = pgEnum('task_review_decision', ['approved', 'rejected']);

/** One-off work for a person or a team (SP5 spec §5). The id is generated by the client, so creation is idempotent. */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    instructions: text('instructions').notNull().default(''),
    priority: taskPriority('priority').notNull().default('normal'),
    siteId: uuid('site_id'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    // A team task has only the team until a member accepts it; then both (spec §5).
    assigneeUserId: uuid('assignee_user_id'),
    assigneeTeamId: uuid('assignee_team_id'),
    requiresReview: boolean('requires_review').notNull().default(false),
    evidence: jsonb('evidence').notNull().default({ photo: 'optional', video: 'optional', liveOnly: false }),
    dueAt: ts('due_at'),
    // Set once by tasks.sweep; a flag, not a status (spec §3).
    overdueAt: ts('overdue_at'),
    problemId: uuid('problem_id'),
    status: taskStatus('status').notNull().default('new'),
    // Bumped on every change.
    rev: integer('rev').notNull().default(1),
    // Device times for worker steps, server times for manager steps (spec §5).
    acceptedAt: ts('accepted_at'),
    startedAt: ts('started_at'),
    submittedAt: ts('submitted_at'),
    completedAt: ts('completed_at'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('tasks_tenant_id_uq').on(t.tenantId, t.id),
    // One task per problem (spec §1).
    unique('tasks_problem_uq').on(t.problemId),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'tasks_site_fk' }),
    foreignKey({ columns: [t.tenantId, t.createdByUserId], foreignColumns: [users.tenantId, users.id], name: 'tasks_created_by_fk' }),
    foreignKey({ columns: [t.tenantId, t.assigneeUserId], foreignColumns: [users.tenantId, users.id], name: 'tasks_assignee_user_fk' }),
    foreignKey({ columns: [t.tenantId, t.assigneeTeamId], foreignColumns: [teams.tenantId, teams.id], name: 'tasks_assignee_team_fk' }),
    foreignKey({ columns: [t.tenantId, t.problemId], foreignColumns: [executionProblems.tenantId, executionProblems.id], name: 'tasks_problem_fk' }).onDelete('restrict'),
    check('tasks_assignee_ck', sql`${t.assigneeUserId} is not null or ${t.assigneeTeamId} is not null`),
    index('tasks_status_idx').on(t.tenantId, t.status),
    index('tasks_assignee_user_idx').on(t.tenantId, t.assigneeUserId),
    index('tasks_assignee_team_idx').on(t.tenantId, t.assigneeTeamId).where(sql`assignee_user_id is null`),
    index('tasks_site_idx').on(t.tenantId, t.siteId),
    index('tasks_due_idx').on(t.tenantId, t.dueAt).where(sql`status not in ('completed', 'cancelled')`),
    index('tasks_sync_idx').on(t.tenantId, t.updatedAt, t.id),
    // GET /tasks keyset.
    index('tasks_created_idx').on(t.tenantId, t.createdAt, t.id),
  ],
);

/** Every submission is kept, with its review (FR-14.10 groundwork). */
export const taskSubmissions = pgTable(
  'task_submissions',
  {
    id: uuid('id').primaryKey(),
    tenantId: tenantId(),
    taskId: uuid('task_id').notNull(),
    submittedByUserId: uuid('submitted_by_user_id').notNull(),
    text: text('text').notNull().default(''),
    mediaIds: uuid('media_ids').array().notNull().default(sql`'{}'::uuid[]`),
    submittedAt: ts('submitted_at').notNull(),
    receivedAt: ts('received_at').notNull(),
    reviewDecision: taskReviewDecision('review_decision'),
    reviewComment: text('review_comment'),
    reviewedByUserId: uuid('reviewed_by_user_id'),
    reviewedAt: ts('reviewed_at'),
  },
  (t) => [
    unique('task_submissions_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: 'task_submissions_task_fk' }),
    foreignKey({ columns: [t.tenantId, t.submittedByUserId], foreignColumns: [users.tenantId, users.id], name: 'task_submissions_submitted_by_fk' }),
    foreignKey({ columns: [t.tenantId, t.reviewedByUserId], foreignColumns: [users.tenantId, users.id], name: 'task_submissions_reviewed_by_fk' }),
    index('task_submissions_task_idx').on(t.tenantId, t.taskId, t.receivedAt),
  ],
);

/** Instruction and response photos/videos. The file lives in object storage under storage_key. */
export const taskMedia = pgTable(
  'task_media',
  {
    id: uuid('id').primaryKey(),
    tenantId: tenantId(),
    taskId: uuid('task_id').notNull(),
    // Set when the submission that lists it is accepted.
    submissionId: uuid('submission_id'),
    role: taskMediaRole('role').notNull(),
    kind: mediaKind('kind').notNull(),
    source: mediaSource('source').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    capturedAt: ts('captured_at').notNull(),
    capturedByUserId: uuid('captured_by_user_id').notNull(),
    storageKey: text('storage_key').notNull(),
    status: mediaStatus('status').notNull().default('pending'),
    uploadedAt: ts('uploaded_at'),
    // Set by task-media.cleanup when it deleted the object of a never-uploaded medium; the row stays.
    storagePurgedAt: ts('storage_purged_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('task_media_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: 'task_media_task_fk' }),
    foreignKey({ columns: [t.tenantId, t.submissionId], foreignColumns: [taskSubmissions.tenantId, taskSubmissions.id], name: 'task_media_submission_fk' }),
    foreignKey({ columns: [t.tenantId, t.capturedByUserId], foreignColumns: [users.tenantId, users.id], name: 'task_media_captured_by_fk' }),
    index('task_media_task_idx').on(t.tenantId, t.taskId),
    index('task_media_status_idx').on(t.tenantId, t.status, t.createdAt),
  ],
);

/** FR-14.09: append-only. Actor null = the system. */
export const taskStatusHistory = pgTable(
  'task_status_history',
  {
    id: id(),
    tenantId: tenantId(),
    taskId: uuid('task_id').notNull(),
    fromStatus: taskStatus('from_status'),
    toStatus: taskStatus('to_status').notNull(),
    actorUserId: uuid('actor_user_id'),
    at: ts('at').notNull(),
    comment: text('comment'),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: 'task_status_history_task_fk' }),
    foreignKey({ columns: [t.tenantId, t.actorUserId], foreignColumns: [users.tenantId, users.id], name: 'task_status_history_actor_fk' }),
    index('task_status_history_task_idx').on(t.tenantId, t.taskId, t.at),
  ],
);

// Must match NOTIFICATION_TARGET_KINDS, DELIVERY_CHANNELS, DELIVERY_STATUSES and PUSH_PLATFORMS in @taskop/contracts.
export const notificationTargetKind = pgEnum('notification_target_kind', ['occurrence', 'task', 'none']);
export const notificationChannel = pgEnum('notification_channel', ['push', 'email']);
export const notificationDeliveryStatus = pgEnum('notification_delivery_status', ['queued', 'sent', 'delivered', 'failed', 'skipped']);
export const pushPlatform = pgEnum('push_platform', ['ios', 'android']);

/** The outbox (SP6 spec §5): one row per business event, inserted in the business transaction. */
export const notificationEvents = pgTable(
  'notification_events',
  {
    id: id(),
    tenantId: tenantId(),
    // A NotificationType.
    type: text('type').notNull(),
    // Ids only; for `manual` the message itself.
    payload: jsonb('payload').notNull(),
    actorUserId: uuid('actor_user_id'),
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    // Null until fan-out finishes.
    processedAt: ts('processed_at'),
    // fanned_out | disabled | no_recipients | target_gone
    outcome: text('outcome'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    unique('notification_events_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('notification_events_dedupe_uq').on(t.tenantId, t.dedupeKey).where(sql`dedupe_key is not null`),
    foreignKey({ columns: [t.tenantId, t.actorUserId], foreignColumns: [users.tenantId, users.id], name: 'notification_events_actor_fk' }),
    // The sweeper.
    index('notification_events_unprocessed_idx').on(t.createdAt).where(sql`processed_at is null`),
    // GET /notifications/messages.
    index('notification_events_manual_idx').on(t.tenantId, t.createdAt).where(sql`type = 'manual'`),
  ],
);

/** The inbox: one row per recipient; title and body are rendered at fan-out and never change. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: tenantId(),
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    targetKind: notificationTargetKind('target_kind').notNull(),
    targetId: uuid('target_id'),
    // The occurrence's local_date, for the web schedule link.
    targetDate: localDate('target_date'),
    createdAt: createdAt(),
    readAt: ts('read_at'),
  },
  (t) => [
    unique('notifications_tenant_id_uq').on(t.tenantId, t.id),
    unique('notifications_event_user_uq').on(t.eventId, t.userId),
    foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [notificationEvents.tenantId, notificationEvents.id], name: 'notifications_event_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'notifications_user_fk' }),
    index('notifications_user_created_idx').on(t.tenantId, t.userId, t.createdAt.desc(), t.id.desc()),
    index('notifications_unread_idx').on(t.tenantId, t.userId).where(sql`read_at is null`),
    // notifications.cleanup.
    index('notifications_created_idx').on(t.tenantId, t.createdAt),
  ],
);

/** One row per channel target (NFR-11.02). */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: id(),
    tenantId: tenantId(),
    notificationId: uuid('notification_id').notNull(),
    channel: notificationChannel('channel').notNull(),
    // Push only. No foreign key: devices are deleted while their deliveries stay (Spec decision 8).
    deviceId: uuid('device_id'),
    status: notificationDeliveryStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    // The Expo ticket id.
    providerRef: text('provider_ref'),
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
    // Set by whoever claims a queued row before calling a provider (prevents double sends).
    claimedAt: ts('claimed_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('notification_deliveries_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.notificationId],
      foreignColumns: [notifications.tenantId, notifications.id],
      name: 'notification_deliveries_notification_fk',
    }).onDelete('cascade'),
    index('notification_deliveries_notification_idx').on(t.tenantId, t.notificationId),
    // notifications.receipts.
    index('notification_deliveries_receipt_idx').on(t.status, t.sentAt).where(sql`channel = 'push' and status = 'sent'`),
    // notifications.sweep.
    index('notification_deliveries_queued_idx').on(t.status, t.createdAt).where(sql`status = 'queued'`),
  ],
);

/** Expo push tokens. A token belongs to one user of one tenant at a time (token claim, spec §6.4). */
export const pushDevices = pgTable(
  'push_devices',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    expoToken: text('expo_token').notNull(),
    platform: pushPlatform('platform').notNull(),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull(),
    disabledAt: ts('disabled_at'),
  },
  (t) => [
    unique('push_devices_tenant_id_uq').on(t.tenantId, t.id),
    // Across all tenants: claiming a token removes every other row first.
    unique('push_devices_token_uq').on(t.expoToken),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'push_devices_user_fk' }),
    index('push_devices_user_idx').on(t.tenantId, t.userId),
  ],
);

/** At most one override per tenant and rule type (FR-15.09); a missing row means DEFAULT_RULES. */
export const notificationRules = pgTable(
  'notification_rules',
  {
    tenantId: tenantId(),
    type: text('type').notNull(),
    enabled: boolean('enabled').notNull(),
    push: boolean('push').notNull(),
    email: boolean('email').notNull(),
    notifyAssignees: boolean('notify_assignees').notNull(),
    notifyCreator: boolean('notify_creator').notNull(),
    roleIds: uuid('role_ids').array().notNull().default(sql`'{}'::uuid[]`),
    // checklist.due_soon only.
    leadMinutes: integer('lead_minutes'),
    // audit.finished only: any | failed (SP8 spec §7.1).
    resultFilter: text('result_filter'),
    updatedAt: updatedAt(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    primaryKey({ name: 'notification_rules_pk', columns: [t.tenantId, t.type] }),
    foreignKey({ columns: [t.tenantId, t.updatedBy], foreignColumns: [users.tenantId, users.id], name: 'notification_rules_updated_by_fk' }),
    check('notification_rules_lead_ck', sql`${t.leadMinutes} is null or ${t.leadMinutes} in (15, 30, 60, 120)`),
    check('notification_rules_result_filter_ck', sql`${t.resultFilter} is null or ${t.resultFilter} in ('any', 'failed')`),
  ],
);

// Must match AUDIT_STATUSES, AUDIT_RESULTS, AUDIT_VERDICTS and AUDIT_REPORT_STATUSES in @taskop/contracts.
export const auditStatus = pgEnum('audit_status', ['in_progress', 'finished', 'cancelled']);
export const auditResult = pgEnum('audit_result', ['passed', 'failed']);
export const auditVerdict = pgEnum('audit_verdict', ['approved', 'rejected']);
export const auditReportStatus = pgEnum('audit_report_status', ['none', 'pending', 'ready', 'failed']);

/** A formal audit of a completed run (SP8 spec §4.2). At most one non-cancelled audit per execution. */
export const audits = pgTable(
  'audits',
  {
    id: id(),
    tenantId: tenantId(),
    executionId: uuid('execution_id').notNull(),
    occurrenceId: uuid('occurrence_id').notNull(),
    status: auditStatus('status').notNull().default('in_progress'),
    auditorUserId: uuid('auditor_user_id'),
    auditorPlatformAdminId: uuid('auditor_platform_admin_id'),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason'),
    result: auditResult('result'),
    // { approved, rejected, reviewed, percent }
    auditScore: jsonb('audit_score'),
    comment: text('comment'),
    reportStatus: auditReportStatus('report_status').notNull().default('none'),
    reportStorageKey: text('report_storage_key'),
    reportRecipients: text('report_recipients').array().notNull().default(sql`'{}'::text[]`),
    reportSentAt: ts('report_sent_at'),
    // Failed attempts of the audit.report job (Spec decision 27).
    reportAttempts: integer('report_attempts').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('audits_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('audits_open_uq').on(t.executionId).where(sql`status <> 'cancelled'`),
    foreignKey({ columns: [t.tenantId, t.executionId], foreignColumns: [executions.tenantId, executions.id], name: 'audits_execution_fk' }),
    foreignKey({ columns: [t.tenantId, t.occurrenceId], foreignColumns: [occurrences.tenantId, occurrences.id], name: 'audits_occurrence_fk' }),
    foreignKey({ columns: [t.tenantId, t.auditorUserId], foreignColumns: [users.tenantId, users.id], name: 'audits_auditor_fk' }),
    check('audits_auditor_ck', sql`num_nonnulls(${t.auditorUserId}, ${t.auditorPlatformAdminId}) = 1`),
    check('audits_finished_ck', sql`(${t.status} = 'finished') = (${t.finishedAt} is not null and ${t.result} is not null)`),
    check('audits_cancelled_ck', sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
    // The queue's In progress and Finished tabs.
    index('audits_status_started_idx').on(t.tenantId, t.status, t.startedAt),
    index('audits_status_finished_idx').on(t.tenantId, t.status, t.finishedAt),
    index('audits_occurrence_idx').on(t.tenantId, t.occurrenceId),
  ],
);

/** One verdict per audited item (FR-19.04–05). Editable while the audit is in progress (Spec decision 23: own tenant_id). */
export const auditItemVerdicts = pgTable(
  'audit_item_verdicts',
  {
    tenantId: tenantId(),
    auditId: uuid('audit_id').notNull(),
    itemId: uuid('item_id').notNull(),
    verdict: auditVerdict('verdict').notNull(),
    comment: text('comment'),
    // Null for a platform admin.
    updatedByUserId: uuid('updated_by_user_id'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'audit_item_verdicts_pk', columns: [t.auditId, t.itemId] }),
    foreignKey({ columns: [t.tenantId, t.auditId], foreignColumns: [audits.tenantId, audits.id], name: 'audit_item_verdicts_audit_fk' }),
    foreignKey({ columns: [t.tenantId, t.updatedByUserId], foreignColumns: [users.tenantId, users.id], name: 'audit_item_verdicts_updated_by_fk' }),
    check('audit_item_verdicts_comment_ck', sql`${t.verdict} <> 'rejected' or ${t.comment} is not null`),
  ],
);
