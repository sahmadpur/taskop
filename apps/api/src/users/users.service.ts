import { Injectable } from '@nestjs/common';
import { type Page, secretSchemaFor, type UserDto, type UserWithSecret } from '@taskop/contracts';
import { and, asc, eq, gt, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { CredentialService } from '../auth/credential.service';
import { PasswordHasher } from '../auth/crypto/password-hasher';
import { generatePassword, generatePin } from '../auth/crypto/secret-generator';
import { SessionService } from '../auth/session.service';
import { AppError } from '../common/app-error';
import { assertIdsExist } from '../common/ids-exist';
import type { Principal } from '../common/request';
import { ScopeService } from '../common/scope.service';
import { escapeLike } from '../common/sql';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { roles, sites, teams, users, userSites, userTeams } from '../db/schema';
import { loadRolePermissions } from '../roles/permission-resolver';
import { assertNoEscalation, assertNoScopeEscalation } from '../roles/roles.service';
import type { CreateWorkerDto, InviteStaffDto, ResetCredentialDto, UpdateUserDto, UserListQueryDto } from './dto';
import { selectUsers, toUserDto } from './user-mapper';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly credentials: CredentialService,
  ) {}

  async list(p: Principal, q: UserListQueryDto): Promise<Page<UserDto>> {
    const conditions: (SQL | undefined)[] = [this.scope.usersFilter(p)];
    if (q.status) conditions.push(eq(users.status, q.status));
    if (q.kind) conditions.push(eq(users.kind, q.kind));
    if (q.roleId) conditions.push(eq(users.roleId, q.roleId));
    if (q.teamId) conditions.push(sql`exists (select 1 from user_teams ut where ut.user_id = ${users.id} and ut.team_id = ${q.teamId})`);
    if (q.siteId) conditions.push(sql`exists (select 1 from user_sites us where us.user_id = ${users.id} and us.site_id = ${q.siteId})`);
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conditions.push(or(ilike(users.fullName, like), ilike(users.username, like), ilike(users.email, like)));
    }
    if (q.cursor) conditions.push(gt(users.id, q.cursor));
    const rows = await selectUsers(this.db.tx())
      .where(and(...conditions))
      .orderBy(asc(users.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(toUserDto);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  async get(p: Principal, id: string): Promise<UserDto> {
    const [row] = await selectUsers(this.db.tx()).where(and(eq(users.id, id), this.scope.usersFilter(p)));
    if (!row) throw new AppError('NOT_FOUND');
    return toUserDto(row);
  }

  async createWorker(p: Principal, input: CreateWorkerDto): Promise<UserWithSecret> {
    const managerId = await this.prepareCreate(p, input.roleId, input.managerId ?? null, input.siteIds, input.teamIds);
    const generatedSecret = input.secret ? null : input.credentialKind === 'pin' ? generatePin() : generatePassword();
    const secret = input.secret ?? generatedSecret!;
    const id = uuidv7();
    await this.db
      .tx()
      .insert(users)
      .values({
        id,
        tenantId: p.tenantId,
        fullName: input.fullName,
        jobTitle: input.jobTitle ?? null,
        phone: input.phone ?? null,
        roleId: input.roleId,
        managerId,
        kind: 'worker',
        username: input.username,
        credentialHash: await this.hasher.hash(secret),
        credentialKind: input.credentialKind,
        status: 'active',
      });
    await this.replaceSites(p.tenantId, id, input.siteIds);
    await this.replaceTeams(p.tenantId, id, input.teamIds);
    const user = await this.load(id);
    await this.audit.record({ action: 'user.created', entityType: 'user', entityId: id, after: user });
    return { user, generatedSecret };
  }

  async inviteStaff(p: Principal, input: InviteStaffDto): Promise<UserDto> {
    if (!p.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED');
    const managerId = await this.prepareCreate(p, input.roleId, input.managerId ?? null, input.siteIds, input.teamIds);
    const id = uuidv7();
    await this.db
      .tx()
      .insert(users)
      .values({
        id,
        tenantId: p.tenantId,
        fullName: input.fullName,
        jobTitle: input.jobTitle ?? null,
        phone: input.phone ?? null,
        roleId: input.roleId,
        managerId,
        kind: 'staff',
        email: input.email,
        status: 'invited',
      });
    await this.replaceSites(p.tenantId, id, input.siteIds);
    await this.replaceTeams(p.tenantId, id, input.teamIds);
    await this.credentials.issueInvite({ tenantId: p.tenantId, userId: id, email: input.email, fullName: input.fullName });
    const user = await this.load(id);
    await this.audit.record({ action: 'user.invited', entityType: 'user', entityId: id, after: user });
    return user;
  }

  async update(p: Principal, id: string, input: UpdateUserDto): Promise<UserDto> {
    const before = await this.get(p, id);
    if (input.roleId && input.roleId !== before.role.id && id === p.userId) throw new AppError('SELF_MODIFICATION');
    if (id !== p.userId) await this.assertCanManageTarget(p, before);
    if (input.roleId && input.roleId !== before.role.id) {
      await this.assertAssignableRole(p, input.roleId, before);
      if (before.role.systemKey === 'owner') await this.assertNotLastOwner(id);
    }
    if (input.managerId) {
      await this.assertManagerInScope(p, input.managerId);
      await this.assertProfileRefs(id, input.managerId, [], []);
    }
    if (input.username !== undefined && before.kind !== 'worker') {
      throw new AppError('VALIDATION_FAILED', { fields: { username: 'errors.validation.invalid' } });
    }
    await this.db
      .tx()
      .update(users)
      .set({
        fullName: input.fullName,
        jobTitle: input.jobTitle,
        phone: input.phone,
        roleId: input.roleId,
        managerId: input.managerId,
        username: input.username,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
    const after = await this.load(id);
    await this.audit.record({ action: 'user.updated', entityType: 'user', entityId: id, before, after });
    return after;
  }

  async deactivate(p: Principal, id: string): Promise<UserDto> {
    if (id === p.userId) throw new AppError('SELF_MODIFICATION');
    const before = await this.get(p, id);
    await this.assertCanManageTarget(p, before);
    if (before.role.systemKey === 'owner') await this.assertNotLastOwner(id);
    if (before.status === 'deactivated') return before;
    await this.db.tx().update(users).set({ status: 'deactivated', updatedAt: new Date() }).where(eq(users.id, id));
    await this.sessions.revokeAllForUser(id);
    const after = await this.load(id);
    await this.audit.record({ action: 'user.deactivated', entityType: 'user', entityId: id, before, after });
    return after;
  }

  async reactivate(p: Principal, id: string): Promise<UserDto> {
    const before = await this.get(p, id);
    await this.assertCanManageTarget(p, before);
    if (before.status !== 'deactivated') return before;
    const [role] = await this.db.tx().select({ active: roles.active }).from(roles).where(eq(roles.id, before.role.id));
    if (!role?.active) throw new AppError('REFERENCE_NOT_FOUND');
    const status = before.credentialKind === null ? 'invited' : 'active';
    await this.db
      .tx()
      .update(users)
      .set({ status, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, id));
    const after = await this.load(id);
    await this.audit.record({ action: 'user.reactivated', entityType: 'user', entityId: id, before, after });
    return after;
  }

  async resetCredential(p: Principal, id: string, input: ResetCredentialDto): Promise<UserWithSecret> {
    if (id === p.userId) throw new AppError('SELF_MODIFICATION');
    const before = await this.get(p, id);
    await this.assertCanManageTarget(p, before);
    if (before.kind === 'staff') {
      // The old password stops working immediately; the mailed link sets a new one.
      await this.db
        .tx()
        .update(users)
        .set({ credentialHash: null, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, id));
      await this.sessions.revokeAllForUser(id);
      await this.credentials.issuePasswordReset({ tenantId: p.tenantId, userId: id, email: before.email!, fullName: before.fullName });
      await this.audit.record({ action: 'user.password_reset_requested', entityType: 'user', entityId: id });
      return { user: await this.load(id), generatedSecret: null };
    }
    const kind = input.credentialKind ?? before.credentialKind ?? 'pin';
    if (input.secret) {
      const check = secretSchemaFor(kind).safeParse(input.secret);
      if (!check.success) {
        throw new AppError('VALIDATION_FAILED', { fields: { secret: check.error.issues[0]?.message ?? 'errors.validation.invalid' } });
      }
    }
    const generatedSecret = input.secret ? null : kind === 'pin' ? generatePin() : generatePassword();
    const secret = input.secret ?? generatedSecret!;
    await this.db
      .tx()
      .update(users)
      .set({
        credentialHash: await this.hasher.hash(secret),
        credentialKind: kind,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
    await this.sessions.revokeAllForUser(id);
    await this.audit.record({ action: 'user.credential_reset', entityType: 'user', entityId: id, after: { credentialKind: kind } });
    return { user: await this.load(id), generatedSecret };
  }

  async setSites(p: Principal, id: string, siteIds: string[]): Promise<UserDto> {
    if (id === p.userId && p.dataScope !== 'all') throw new AppError('SELF_MODIFICATION');
    const before = await this.get(p, id);
    await this.assertCanManageTarget(p, before);
    await this.assertSitesInScope(p, siteIds);
    await this.replaceSites(p.tenantId, id, siteIds);
    const after = await this.load(id);
    await this.audit.record({ action: 'user.sites_changed', entityType: 'user', entityId: id, before: { siteIds: before.siteIds }, after: { siteIds: after.siteIds } });
    return after;
  }

  async setTeams(p: Principal, id: string, teamIds: string[]): Promise<UserDto> {
    if (id === p.userId && p.dataScope !== 'all') throw new AppError('SELF_MODIFICATION');
    const before = await this.get(p, id);
    await this.assertCanManageTarget(p, before);
    await assertIdsExist(this.db.tx(), teams, teams.id, teamIds);
    await this.replaceTeams(p.tenantId, id, teamIds);
    const after = await this.load(id);
    await this.audit.record({ action: 'user.teams_changed', entityType: 'user', entityId: id, before: { teamIds: before.teamIds }, after: { teamIds: after.teamIds } });
    return after;
  }

  /** Unscoped load, used after writes the actor was already authorised for. */
  private async load(id: string): Promise<UserDto> {
    const [row] = await selectUsers(this.db.tx()).where(eq(users.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    return toUserDto(row);
  }

  private async assertAssignableRole(p: Principal, roleId: string, target: UserDto | null): Promise<void> {
    const tx = this.db.tx();
    const [role] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.active, true)));
    if (!role) throw new AppError('REFERENCE_NOT_FOUND');
    if ((role.systemKey === 'owner' || target?.role.systemKey === 'owner') && p.systemRoleKey !== 'owner') {
      throw new AppError('OWNER_ROLE_RESTRICTED');
    }
    assertNoEscalation(p, await loadRolePermissions(tx, role));
    assertNoScopeEscalation(p, role.dataScope);
  }

  /** Rules shared by every write on an existing user: owner protection and no managing someone more privileged than the actor. */
  private async assertCanManageTarget(p: Principal, target: UserDto): Promise<void> {
    if (target.role.systemKey === 'owner' && p.systemRoleKey !== 'owner') throw new AppError('OWNER_ROLE_RESTRICTED');
    const tx = this.db.tx();
    const [role] = await tx.select().from(roles).where(eq(roles.id, target.role.id));
    if (!role) throw new AppError('NOT_FOUND');
    assertNoEscalation(p, await loadRolePermissions(tx, role));
    assertNoScopeEscalation(p, role.dataScope);
    // Equal scope rank isn't enough: a site lead must cover every site the target has.
    if (p.dataScope === 'site_subtree' && !(await this.allInSubtree(p, target.siteIds))) throw new AppError('FORBIDDEN');
  }

  /** Common checks for creating a user; returns the manager id to store. */
  private async prepareCreate(p: Principal, roleId: string, managerId: string | null, siteIds: string[], teamIds: string[]): Promise<string | null> {
    if (p.dataScope === 'own') throw new AppError('FORBIDDEN');
    if (p.dataScope === 'site_subtree' && new Set(siteIds).size === 0) {
      throw new AppError('VALIDATION_FAILED', { fields: { siteIds: 'errors.validation.required' } });
    }
    await this.assertAssignableRole(p, roleId, null);
    const effectiveManager = managerId ?? (p.dataScope === 'subordinates' ? p.userId : null);
    if (effectiveManager) await this.assertManagerInScope(p, effectiveManager);
    await this.assertSitesInScope(p, siteIds);
    await this.assertProfileRefs(null, effectiveManager, [], teamIds);
    return effectiveManager;
  }

  private async assertManagerInScope(p: Principal, managerId: string): Promise<void> {
    if (p.dataScope !== 'subordinates' || managerId === p.userId) return;
    const [row] = await this.db.tx().select({ id: users.id }).from(users).where(and(eq(users.id, managerId), this.scope.usersFilter(p)));
    if (!row) throw new AppError('REFERENCE_NOT_FOUND');
  }

  private async assertSitesInScope(p: Principal, siteIds: string[]): Promise<void> {
    await assertIdsExist(this.db.tx(), sites, sites.id, [...new Set(siteIds)]);
    if (p.dataScope === 'site_subtree' && !(await this.allInSubtree(p, siteIds))) throw new AppError('REFERENCE_NOT_FOUND');
  }

  /** Whether every given site lies at or below one of the principal's own sites. */
  private async allInSubtree(p: Principal, siteIds: string[]): Promise<boolean> {
    const unique = [...new Set(siteIds)];
    if (unique.length === 0) return true;
    const rows = await this.db
      .tx()
      .select({ id: sites.id })
      .from(sites)
      .where(
        and(
          inArray(sites.id, unique),
          sql`exists (select 1 from user_sites mine join sites ms on ms.id = mine.site_id where mine.user_id = ${p.userId} and ${sites.path} <@ ms.path)`,
        ),
      );
    return rows.length === unique.length;
  }

  private async assertProfileRefs(userId: string | null, managerId: string | null, siteIds: string[], teamIds: string[]): Promise<void> {
    const tx = this.db.tx();
    if (managerId) {
      if (managerId === userId) throw new AppError('MANAGER_CYCLE');
      await assertIdsExist(tx, users, users.id, [managerId]);
      if (userId) {
        const result = await tx.execute(sql`
          with recursive up as (
            select id, manager_id from users where id = ${managerId}
            union
            select u.id, u.manager_id from users u join up on u.id = up.manager_id
          ) select 1 from up where id = ${userId} limit 1`);
        if (result.rows.length > 0) throw new AppError('MANAGER_CYCLE');
      }
    }
    await assertIdsExist(tx, sites, sites.id, siteIds);
    await assertIdsExist(tx, teams, teams.id, teamIds);
  }

  private async assertNotLastOwner(excludingUserId: string): Promise<void> {
    const owners = await this.db
      .tx()
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(roles.systemKey, 'owner'), eq(users.status, 'active')))
      .for('update', { of: users });
    if (!owners.some((o) => o.id !== excludingUserId)) throw new AppError('LAST_OWNER');
  }

  private async replaceSites(tenantId: string, userId: string, siteIds: string[]): Promise<void> {
    const tx = this.db.tx();
    await tx.delete(userSites).where(eq(userSites.userId, userId));
    const unique = [...new Set(siteIds)];
    if (unique.length) await tx.insert(userSites).values(unique.map((siteId) => ({ tenantId, userId, siteId })));
  }

  private async replaceTeams(tenantId: string, userId: string, teamIds: string[]): Promise<void> {
    const tx = this.db.tx();
    await tx.delete(userTeams).where(eq(userTeams.userId, userId));
    const unique = [...new Set(teamIds)];
    if (unique.length) await tx.insert(userTeams).values(unique.map((teamId) => ({ tenantId, userId, teamId })));
  }
}
