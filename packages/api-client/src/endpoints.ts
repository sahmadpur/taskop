import {
  assignmentDetailSchema,
  type AssignmentListQuery,
  assignmentDtoSchema,
  assignmentPreviewSchema,
  type CancelOccurrenceInput,
  type CopyRosterInput,
  type CreateAssignmentInput,
  type CreateShiftInput,
  type MyOccurrenceQuery,
  occurrenceDetailSchema,
  occurrenceDtoSchema,
  type OccurrenceListQuery,
  type PreviewAssignmentInput,
  type PutRosterInput,
  rosterCopyResultSchema,
  rosterDtoSchema,
  type RosterQuery,
  shiftDtoSchema,
  type ShiftListQuery,
  type UpdateAssignmentInput,
  type UpdateShiftInput,
  checklistDetailSchema,
  type ChecklistListQuery,
  checklistSummarySchema,
  checklistVersionSchema,
  checklistVersionSummarySchema,
  contentSaveResultSchema,
  type CreateChecklistInput,
  type CreateTemplateInput,
  globalTemplateSchema,
  globalTemplateSummarySchema,
  type PublishInput,
  type SaveAsTemplateInput,
  type SaveContentInput,
  type StartDraftInput,
  type TemplateListQuery,
  templateSchema,
  templateSummarySchema,
  type UpdateChecklistInput,
  type UpdateGlobalTemplateInput,
  type UpdateTemplateInput,
  type AuditListQuery,
  auditEntryDtoSchema,
  type ChangeCredentialInput,
  type CreateRoleInput,
  type CreateSiteInput,
  type CreateSiteTypeInput,
  type CreateTeamInput,
  type CreateWorkerInput,
  type InviteAcceptInput,
  type InviteStaffInput,
  type LoginStaffInput,
  type LoginWorkerInput,
  loginResultSchema,
  meSchema,
  type MoveSiteInput,
  pageOf,
  permissionCatalogSchema,
  type PlatformLoginInput,
  platformLoginResultSchema,
  platformTenantDtoSchema,
  type PlatformTenantListQuery,
  type ResetCredentialInput,
  roleDtoSchema,
  type SignupInput,
  siteDtoSchema,
  siteTypeDtoSchema,
  teamDtoSchema,
  tenantDtoSchema,
  type UpdateRoleInput,
  type UpdateSiteInput,
  type UpdateSiteTypeInput,
  type UpdateTeamInput,
  type UpdateTenantInput,
  type UpdateUserInput,
  userDtoSchema,
  type UserListQuery,
  userWithSecretSchema,
  type PermissionKey,
} from '@taskop/contracts';
import { z } from 'zod';
import type { ApiClient, QueryParams } from './client.js';

const q = (query: object) => query as QueryParams;

export function createTaskopApi(c: ApiClient) {
  return {
    auth: {
      signup: (body: SignupInput) => c.request('POST', '/auth/signup', { body, schema: loginResultSchema, auth: false }),
      loginStaff: (body: LoginStaffInput) => c.request('POST', '/auth/login/staff', { body, schema: loginResultSchema, auth: false }),
      loginWorker: (body: LoginWorkerInput) => c.request('POST', '/auth/login/worker', { body, schema: loginResultSchema, auth: false }),
      verifyEmail: (token: string) => c.request<void>('POST', '/auth/verify-email', { body: { token }, auth: false }),
      resendVerification: () => c.request<void>('POST', '/auth/verify-email/resend', { body: {} }),
      acceptInvite: (body: InviteAcceptInput) => c.request('POST', '/auth/invite/accept', { body, schema: loginResultSchema, auth: false }),
      forgotPassword: (email: string) => c.request<void>('POST', '/auth/password/forgot', { body: { email }, auth: false }),
      resetPassword: (token: string, password: string) =>
        c.request<void>('POST', '/auth/password/reset', { body: { token, password }, auth: false }),
      changeCredential: (body: ChangeCredentialInput) => c.request<void>('POST', '/auth/credential/change', { body }),
      logout: () => c.request<void>('POST', '/auth/logout', { body: {} }),
    },
    me: () => c.request('GET', '/me', { schema: meSchema }),
    tenant: {
      get: () => c.request('GET', '/tenant', { schema: tenantDtoSchema }),
      update: (body: UpdateTenantInput) => c.request('PATCH', '/tenant', { body, schema: tenantDtoSchema }),
    },
    siteTypes: {
      list: () => c.request('GET', '/site-types', { schema: z.array(siteTypeDtoSchema) }),
      create: (body: CreateSiteTypeInput) => c.request('POST', '/site-types', { body, schema: siteTypeDtoSchema }),
      update: (id: string, body: UpdateSiteTypeInput) => c.request('PATCH', `/site-types/${id}`, { body, schema: siteTypeDtoSchema }),
    },
    sites: {
      list: () => c.request('GET', '/sites', { schema: z.array(siteDtoSchema) }),
      create: (body: CreateSiteInput) => c.request('POST', '/sites', { body, schema: siteDtoSchema }),
      update: (id: string, body: UpdateSiteInput) => c.request('PATCH', `/sites/${id}`, { body, schema: siteDtoSchema }),
      move: (id: string, body: MoveSiteInput) => c.request('POST', `/sites/${id}/move`, { body, schema: siteDtoSchema }),
    },
    teams: {
      list: () => c.request('GET', '/teams', { schema: z.array(teamDtoSchema) }),
      create: (body: CreateTeamInput) => c.request('POST', '/teams', { body, schema: teamDtoSchema }),
      update: (id: string, body: UpdateTeamInput) => c.request('PATCH', `/teams/${id}`, { body, schema: teamDtoSchema }),
      setMembers: (id: string, userIds: string[]) => c.request('PUT', `/teams/${id}/members`, { body: { userIds }, schema: teamDtoSchema }),
    },
    roles: {
      list: () => c.request('GET', '/roles', { schema: z.array(roleDtoSchema) }),
      catalog: () => c.request('GET', '/permissions', { schema: permissionCatalogSchema }),
      create: (body: CreateRoleInput) => c.request('POST', '/roles', { body, schema: roleDtoSchema }),
      update: (id: string, body: UpdateRoleInput) => c.request('PATCH', `/roles/${id}`, { body, schema: roleDtoSchema }),
      setPermissions: (id: string, permissions: PermissionKey[]) =>
        c.request('PUT', `/roles/${id}/permissions`, { body: { permissions }, schema: roleDtoSchema }),
    },
    users: {
      list: (query: UserListQuery = {}) => c.request('GET', '/users', { query: q(query), schema: pageOf(userDtoSchema) }),
      get: (id: string) => c.request('GET', `/users/${id}`, { schema: userDtoSchema }),
      createWorker: (body: CreateWorkerInput) => c.request('POST', '/users/workers', { body, schema: userWithSecretSchema }),
      invite: (body: InviteStaffInput) => c.request('POST', '/users/invite', { body, schema: userDtoSchema }),
      update: (id: string, body: UpdateUserInput) => c.request('PATCH', `/users/${id}`, { body, schema: userDtoSchema }),
      deactivate: (id: string) => c.request('POST', `/users/${id}/deactivate`, { body: {}, schema: userDtoSchema }),
      reactivate: (id: string) => c.request('POST', `/users/${id}/reactivate`, { body: {}, schema: userDtoSchema }),
      resetCredential: (id: string, body: ResetCredentialInput = {}) =>
        c.request('POST', `/users/${id}/reset-credential`, { body, schema: userWithSecretSchema }),
      setSites: (id: string, siteIds: string[]) => c.request('PUT', `/users/${id}/sites`, { body: { siteIds }, schema: userDtoSchema }),
      setTeams: (id: string, teamIds: string[]) => c.request('PUT', `/users/${id}/teams`, { body: { teamIds }, schema: userDtoSchema }),
    },
    audit: {
      list: (query: AuditListQuery = {}) => c.request('GET', '/audit-log', { query: q(query), schema: pageOf(auditEntryDtoSchema) }),
    },
    checklists: createChecklistsApi(c),
    templates: createTemplatesApi(c),
    ...createSchedulingApi(c),
  };
}
/** `base` is '' for tenant users or `/platform/tenants/<id>` for platform admins working in a tenant. */
export function createChecklistsApi(c: ApiClient, base = '') {
  const p = `${base}/checklists`;
  return {
    list: (query: ChecklistListQuery = {}) => c.request('GET', p, { query: q(query), schema: pageOf(checklistSummarySchema) }),
    get: (id: string) => c.request('GET', `${p}/${id}`, { schema: checklistDetailSchema }),
    create: (body: CreateChecklistInput) => c.request('POST', p, { body, schema: checklistDetailSchema }),
    update: (id: string, body: UpdateChecklistInput) => c.request('PATCH', `${p}/${id}`, { body, schema: checklistDetailSchema }),
    version: (id: string, versionId: string) => c.request('GET', `${p}/${id}/versions/${versionId}`, { schema: checklistVersionSchema }),
    draft: (id: string) => c.request('GET', `${p}/${id}/draft`, { schema: checklistVersionSchema }),
    startDraft: (id: string, body: StartDraftInput = {}) => c.request('POST', `${p}/${id}/draft`, { body, schema: checklistVersionSchema }),
    saveDraft: (id: string, body: SaveContentInput) => c.request('PUT', `${p}/${id}/draft`, { body, schema: contentSaveResultSchema }),
    discardDraft: (id: string) => c.request<void>('DELETE', `${p}/${id}/draft`),
    publish: (id: string, body: PublishInput) => c.request('POST', `${p}/${id}/publish`, { body, schema: checklistVersionSummarySchema }),
    deactivate: (id: string) => c.request('POST', `${p}/${id}/deactivate`, { body: {}, schema: checklistDetailSchema }),
    reactivate: (id: string) => c.request('POST', `${p}/${id}/reactivate`, { body: {}, schema: checklistDetailSchema }),
    saveAsTemplate: (id: string, versionId: string, body: SaveAsTemplateInput) =>
      c.request('POST', `${p}/${id}/versions/${versionId}/save-as-template`, { body, schema: templateSchema }),
  };
}
export type ChecklistsApi = ReturnType<typeof createChecklistsApi>;

export function createTemplatesApi(c: ApiClient, base = '') {
  const p = `${base}/templates`;
  return {
    list: (query: TemplateListQuery = {}) => c.request('GET', p, { query: q(query), schema: z.array(templateSummarySchema) }),
    get: (source: 'global' | 'tenant', id: string) => c.request('GET', `${p}/${source}/${id}`, { schema: templateSchema }),
    create: (body: CreateTemplateInput) => c.request('POST', p, { body, schema: templateSchema }),
    update: (id: string, body: UpdateTemplateInput) => c.request('PATCH', `${p}/${id}`, { body, schema: templateSchema }),
    saveContent: (id: string, body: SaveContentInput) => c.request('PUT', `${p}/${id}/content`, { body, schema: contentSaveResultSchema }),
    deactivate: (id: string) => c.request('POST', `${p}/${id}/deactivate`, { body: {}, schema: templateSchema }),
    reactivate: (id: string) => c.request('POST', `${p}/${id}/reactivate`, { body: {}, schema: templateSchema }),
  };
}
export type TemplatesApi = ReturnType<typeof createTemplatesApi>;

export type TaskopApi = ReturnType<typeof createTaskopApi>;

export function createPlatformApi(c: ApiClient) {
  return {
    login: (body: PlatformLoginInput) => c.request('POST', '/platform/auth/login', { body, schema: platformLoginResultSchema, auth: false }),
    tenants: {
      list: (query: PlatformTenantListQuery = {}) =>
        c.request('GET', '/platform/tenants', { query: q(query), schema: pageOf(platformTenantDtoSchema) }),
      suspend: (id: string) => c.request('POST', `/platform/tenants/${id}/suspend`, { body: {}, schema: platformTenantDtoSchema }),
      reactivate: (id: string) => c.request('POST', `/platform/tenants/${id}/reactivate`, { body: {}, schema: platformTenantDtoSchema }),
    },
    globalTemplates: {
      list: () => c.request('GET', '/platform/templates', { schema: z.array(globalTemplateSummarySchema) }),
      get: (id: string) => c.request('GET', `/platform/templates/${id}`, { schema: globalTemplateSchema }),
      create: (body: CreateTemplateInput) => c.request('POST', '/platform/templates', { body, schema: globalTemplateSchema }),
      update: (id: string, body: UpdateGlobalTemplateInput) => c.request('PATCH', `/platform/templates/${id}`, { body, schema: globalTemplateSchema }),
      saveContent: (id: string, body: SaveContentInput) => c.request('PUT', `/platform/templates/${id}/content`, { body, schema: contentSaveResultSchema }),
      publish: (id: string) => c.request('POST', `/platform/templates/${id}/publish`, { body: {}, schema: globalTemplateSchema }),
      unpublish: (id: string) => c.request('POST', `/platform/templates/${id}/unpublish`, { body: {}, schema: globalTemplateSchema }),
    },
    inTenant: (tenantId: string) => ({
      checklists: createChecklistsApi(c, `/platform/tenants/${tenantId}`),
      templates: createTemplatesApi(c, `/platform/tenants/${tenantId}`),
    }),
  };
}
export type PlatformApi = ReturnType<typeof createPlatformApi>;

export function createSchedulingApi(c: ApiClient) {
  return {
    shifts: {
      list: (query: ShiftListQuery = {}) => c.request('GET', '/shifts', { query: q(query), schema: z.array(shiftDtoSchema) }),
      create: (body: CreateShiftInput) => c.request('POST', '/shifts', { body, schema: shiftDtoSchema }),
      update: (id: string, body: UpdateShiftInput) => c.request('PATCH', `/shifts/${id}`, { body, schema: shiftDtoSchema }),
    },
    roster: {
      get: (query: RosterQuery) => c.request('GET', '/roster', { query: q(query), schema: rosterDtoSchema }),
      put: (body: PutRosterInput) => c.request('PUT', '/roster', { body, schema: rosterDtoSchema }),
      copy: (body: CopyRosterInput) => c.request('POST', '/roster/copy', { body, schema: rosterCopyResultSchema }),
    },
    assignments: {
      list: (query: AssignmentListQuery = {}) => c.request('GET', '/assignments', { query: q(query), schema: pageOf(assignmentDtoSchema) }),
      get: (id: string) => c.request('GET', `/assignments/${id}`, { schema: assignmentDetailSchema }),
      create: (body: CreateAssignmentInput) => c.request('POST', '/assignments', { body, schema: assignmentDetailSchema }),
      update: (id: string, body: UpdateAssignmentInput) => c.request('PUT', `/assignments/${id}`, { body, schema: assignmentDetailSchema }),
      preview: (body: PreviewAssignmentInput) => c.request('POST', '/assignments/preview', { body, schema: assignmentPreviewSchema }),
      pause: (id: string) => c.request('POST', `/assignments/${id}/pause`, { body: {}, schema: assignmentDetailSchema }),
      resume: (id: string) => c.request('POST', `/assignments/${id}/resume`, { body: {}, schema: assignmentDetailSchema }),
      end: (id: string) => c.request('POST', `/assignments/${id}/end`, { body: {}, schema: assignmentDetailSchema }),
    },
    occurrences: {
      list: (query: OccurrenceListQuery) => c.request('GET', '/occurrences', { query: q(query), schema: pageOf(occurrenceDtoSchema) }),
      get: (id: string) => c.request('GET', `/occurrences/${id}`, { schema: occurrenceDetailSchema }),
      cancel: (id: string, body: CancelOccurrenceInput) => c.request('POST', `/occurrences/${id}/cancel`, { body, schema: occurrenceDetailSchema }),
      mine: (query: MyOccurrenceQuery) => c.request('GET', '/me/occurrences', { query: q(query), schema: pageOf(occurrenceDtoSchema) }),
    },
  };
}
export type SchedulingApi = ReturnType<typeof createSchedulingApi>;
