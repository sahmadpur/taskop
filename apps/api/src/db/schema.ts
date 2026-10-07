import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
    tenantId: tenantId(),
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
  (t) => [index('audit_log_tenant_time_idx').on(t.tenantId, t.occurredAt)],
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
