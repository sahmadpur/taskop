import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LoginResult } from '@taskop/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { currentRequestMeta } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { roles, sessions, tenants, users } from '../db/schema';
import { MAILER, type Mailer, type MailMessage } from '../mail/mailer';
import { verifyEmailMail } from '../mail/templates';
import { seedTenantDefaults } from '../tenancy/bootstrap';
import { hashOpaqueToken, parseOpaqueToken } from './crypto/opaque-token';
import { PasswordHasher } from './crypto/password-hasher';
import { TokenService } from './crypto/token.service';
import type { LoginStaffDto, LoginWorkerDto, SignupDto } from './dto';
import { type LoginCandidate, LoginLookup } from './login-lookup';
import { MeService } from './me.service';
import { OneTimeTokenService } from './one-time-token.service';
import { RateLimitService } from './rate-limit.service';
import { type Client, SessionService } from './session.service';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MS = 15 * 60_000;
export const REFRESH_GRACE_MS = 30_000;

const secondsUntil = (d: Date) => Math.max(1, Math.ceil((d.getTime() - Date.now()) / 1000));

export interface IssuedLogin {
  result: LoginResult;
  refreshToken: string;
  sessionId: string;
  client: Client;
}

export interface LoginSubject {
  id: string;
  tenantId: string;
  roleId: string;
  kind: 'worker' | 'staff';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly oneTime: OneTimeTokenService,
    private readonly me: MeService,
    private readonly rateLimit: RateLimitService,
    private readonly lookup: LoginLookup,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async signup(input: SignupDto): Promise<IssuedLogin> {
    await this.rateLimit.consume(`signup:ip:${currentRequestMeta().ip}`, this.config.RL_SIGNUP_IP_PER_HOUR, 3600);
    const tenantId = uuidv7();
    const userId = uuidv7();
    const credentialHash = await this.hasher.hash(input.password);
    let verifyToken = '';
    const issued = await this.db.withTenant(tenantId, userId, async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ id: tenantId, name: input.orgName, orgCode: input.orgCode }).returning();
      const roleIds = await seedTenantDefaults(tx, tenantId);
      await tx.insert(users).values({
        id: userId,
        tenantId,
        fullName: input.fullName,
        roleId: roleIds.owner,
        kind: 'staff',
        email: input.email,
        credentialHash,
        credentialKind: 'password',
        status: 'active',
      });
      verifyToken = await this.oneTime.create({ tenantId, userId, purpose: 'email_verify' });
      await this.audit.record({ action: 'tenant.created', entityType: 'tenant', entityId: tenantId, after: tenant });
      await this.audit.record({
        action: 'user.created',
        entityType: 'user',
        entityId: userId,
        after: { fullName: input.fullName, email: input.email, role: 'owner', kind: 'staff' },
      });
      return this.issueLogin({ id: userId, tenantId, roleId: roleIds.owner, kind: 'staff' }, input.client);
    });
    await this.sendMail(verifyEmailMail({ to: input.email, fullName: input.fullName, webUrl: this.config.WEB_URL, token: verifyToken }));
    return issued;
  }

  async verifyEmail(token: string): Promise<void> {
    const parsed = parseOpaqueToken(token);
    if (!parsed) throw new AppError('TOKEN_INVALID');
    await this.db.withTenant(parsed.tenantId, null, async (tx) => {
      const { userId } = await this.oneTime.consume(token, 'email_verify');
      await tx.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
      await this.audit.record({ action: 'user.email_verified', entityType: 'user', entityId: userId, actorUserId: userId });
    });
  }

  async loginStaff(input: LoginStaffDto): Promise<IssuedLogin> {
    await this.limitLogin(`staff:${input.email}`);
    return this.completeLogin(await this.lookup.staffByEmail(input.email), input.password, input.client);
  }

  async loginWorker(input: LoginWorkerDto): Promise<IssuedLogin> {
    await this.limitLogin(`worker:${input.orgCode}:${input.username}`);
    return this.completeLogin(await this.lookup.worker(input.orgCode, input.username), input.secret, input.client);
  }

  async refresh(rawToken: string | undefined): Promise<IssuedLogin> {
    const parsed = rawToken ? parseOpaqueToken(rawToken) : null;
    if (!rawToken || !parsed) throw new AppError('UNAUTHENTICATED');
    // Revocations must commit, so failures are returned from the transaction and thrown after it.
    const outcome = await this.db.withTenant(parsed.tenantId, null, async (tx) => {
      const [session] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.refreshTokenHash, hashOpaqueToken(rawToken)))
        .for('update');
      if (!session) return null;
      const now = Date.now();
      if (session.replacedBy) {
        if (session.revokedAt && now - session.revokedAt.getTime() < REFRESH_GRACE_MS) return null;
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.familyId, session.familyId), isNull(sessions.revokedAt)));
        await this.audit.record({
          action: 'auth.refresh_reuse_detected',
          entityType: 'session',
          entityId: session.id,
          actorUserId: session.userId,
        });
        return null;
      }
      if (session.revokedAt || session.expiresAt.getTime() <= now) return null;
      const [user] = await tx
        .select({ id: users.id, tenantId: users.tenantId, roleId: users.roleId, kind: users.kind, status: users.status, tenantStatus: tenants.status })
        .from(users)
        .innerJoin(tenants, eq(tenants.id, users.tenantId))
        .where(eq(users.id, session.userId));
      if (!user || user.status !== 'active' || user.tenantStatus !== 'active') {
        await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));
        return null;
      }
      const issued = await this.issueLogin(user, session.client, session.familyId);
      await tx.update(sessions).set({ revokedAt: new Date(), replacedBy: issued.sessionId }).where(eq(sessions.id, session.id));
      return issued;
    });
    if (!outcome) throw new AppError('UNAUTHENTICATED');
    return outcome;
  }

  private async limitLogin(accountKey: string): Promise<void> {
    const ip = currentRequestMeta().ip ?? 'unknown';
    await this.rateLimit.consume(`login:ip:${ip}`, this.config.RL_LOGIN_IP_PER_MIN, 60);
    await this.rateLimit.consume(`login:acct:${accountKey}`, this.config.RL_LOGIN_ACCOUNT_PER_MIN, 60);
  }

  private async completeLogin(row: LoginCandidate | null, secret: string, client: Client): Promise<IssuedLogin> {
    if (!row) {
      await this.hasher.verify(null, secret);
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
      throw new AppError('ACCOUNT_LOCKED', { retryAfterSeconds: secondsUntil(row.lockedUntil) });
    }
    const valid = await this.hasher.verify(row.credentialHash, secret);
    if (!valid || row.status !== 'active') {
      const lockedUntil = await this.recordFailure(row, valid ? 'inactive' : 'bad_secret');
      if (lockedUntil) throw new AppError('ACCOUNT_LOCKED', { retryAfterSeconds: secondsUntil(lockedUntil) });
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (row.tenantStatus !== 'active') throw new AppError('TENANT_SUSPENDED');
    return this.db.withTenant(row.tenantId, row.id, async (tx) => {
      await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, row.id));
      await this.audit.record({ action: 'auth.login_succeeded', entityType: 'user', entityId: row.id, after: { client } });
      return this.issueLogin(row, client);
    });
  }

  /** Counts a bad secret toward the lockout; returns the lock expiry if this failure locked the account. */
  private async recordFailure(row: LoginCandidate, reason: 'bad_secret' | 'inactive'): Promise<Date | null> {
    return this.db.withTenant(row.tenantId, null, async (tx) => {
      let lockedUntil: Date | null = null;
      if (reason === 'bad_secret') {
        // Single atomic statement: concurrent failures must each increment, never overwrite.
        const expired = sql`(${users.lockedUntil} is not null and ${users.lockedUntil} <= now())`;
        const nextCount = sql`(case when ${expired} then 1 else ${users.failedLoginCount} + 1 end)`;
        const [updated] = await tx
          .update(users)
          .set({
            failedLoginCount: sql`${nextCount}`,
            lockedUntil: sql`(case when ${nextCount} >= ${MAX_FAILED_LOGINS} then now() + ${LOCK_MS / 1000} * interval '1 second' when ${expired} then null else ${users.lockedUntil} end)`,
          })
          .where(eq(users.id, row.id))
          .returning({ lockedUntil: users.lockedUntil, count: users.failedLoginCount });
        lockedUntil = updated && updated.count >= MAX_FAILED_LOGINS ? updated.lockedUntil : null;
      }
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: row.id,
        actorUserId: null,
        after: { reason, locked: lockedUntil !== null },
      });
      return lockedUntil;
    });
  }

  /** Creates a session and access token. Must run inside the subject's tenant transaction. */
  async issueLogin(subject: LoginSubject, client: Client, familyId?: string): Promise<IssuedLogin> {
    const tx = this.db.tx();
    const [role] = await tx.select({ version: roles.version }).from(roles).where(eq(roles.id, subject.roleId));
    const { sessionId, refreshToken } = await this.sessions.create({ tenantId: subject.tenantId, userId: subject.id, client, familyId });
    const { token, expiresAt } = await this.tokens.signAccess({
      sub: subject.id,
      tid: subject.tenantId,
      rid: subject.roleId,
      rv: role?.version ?? 1,
      kind: subject.kind,
      sid: sessionId,
    });
    const me = await this.me.load(subject.id);
    return {
      result: {
        accessToken: token,
        accessTokenExpiresAt: expiresAt.toISOString(),
        refreshToken: client === 'mobile' ? refreshToken : null,
        me,
      },
      refreshToken,
      sessionId,
      client,
    };
  }

  /** Runs inside the request's tenant transaction (authenticated route). */
  async logout(p: Principal): Promise<void> {
    await this.db
      .tx()
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, p.sessionId), isNull(sessions.revokedAt)));
    await this.audit.record({ action: 'auth.logout', entityType: 'session', entityId: p.sessionId });
  }

  async resendVerification(p: Principal): Promise<void> {
    if (p.emailVerified) return;
    await this.rateLimit.consume(`verify-resend:${p.userId}`, 3, 3600);
    const [user] = await this.db.tx().select({ email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, p.userId));
    if (!user?.email) return;
    const token = await this.oneTime.create({ tenantId: p.tenantId, userId: p.userId, purpose: 'email_verify' });
    await this.sendMail(verifyEmailMail({ to: user.email, fullName: user.fullName, webUrl: this.config.WEB_URL, token }));
  }

  /** Mail failures are logged, never surfaced: the user-facing action already succeeded. */
  async sendMail(message: MailMessage): Promise<void> {
    try {
      await this.mailer.send(message);
    } catch (err) {
      this.logger.error({ err, to: message.to }, 'Failed to send mail');
    }
  }
}
