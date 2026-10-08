import { Inject, Injectable } from '@nestjs/common';
import { secretSchemaFor } from '@taskop/contracts';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { currentRequestMeta } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { tenants, users } from '../db/schema';
import { inviteMail, passwordResetMail } from '../mail/templates';
import { type IssuedLogin, AuthService } from './auth.service';
import { parseOpaqueToken } from './crypto/opaque-token';
import { PasswordHasher } from './crypto/password-hasher';
import type { ChangeCredentialDto, InviteAcceptDto } from './dto';
import { LoginLookup } from './login-lookup';
import { OneTimeTokenService } from './one-time-token.service';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';

@Injectable()
export class CredentialService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly hasher: PasswordHasher,
    private readonly oneTime: OneTimeTokenService,
    private readonly sessions: SessionService,
    private readonly lookup: LoginLookup,
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async forgotPassword(email: string): Promise<void> {
    await this.rateLimit.consume(`forgot:ip:${currentRequestMeta().ip}`, this.config.RL_FORGOT_IP_PER_HOUR, 3600);
    const candidate = await this.lookup.staffByEmail(email);
    if (!candidate || candidate.status !== 'active') return;
    const mail = await this.db.withTenant(candidate.tenantId, null, async (tx) => {
      const [user] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, candidate.id));
      const token = await this.oneTime.create({ tenantId: candidate.tenantId, userId: candidate.id, purpose: 'password_reset' });
      return passwordResetMail({ to: email, fullName: user?.fullName ?? '', webUrl: this.config.WEB_URL, token });
    });
    // Not awaited: response time must not reveal whether the account exists (sendMail catches and logs).
    void this.auth.sendMail(mail);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const parsed = parseOpaqueToken(token);
    if (!parsed) throw new AppError('TOKEN_INVALID');
    const credentialHash = await this.hasher.hash(password);
    await this.db.withTenant(parsed.tenantId, null, async (tx) => {
      const { userId } = await this.oneTime.consume(token, 'password_reset');
      await tx
        .update(users)
        .set({ credentialHash, credentialKind: 'password', failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await this.sessions.revokeAllForUser(userId);
      await this.audit.record({ action: 'user.password_reset', entityType: 'user', entityId: userId, actorUserId: userId });
    });
  }

  /** Authenticated route: runs inside the request's tenant transaction. */
  async changeCredential(p: Principal, input: ChangeCredentialDto): Promise<void> {
    await this.rateLimit.consume(`credential-change:${p.userId}`, 5, 900);
    const tx = this.db.tx();
    const [user] = await tx
      .select({ credentialHash: users.credentialHash, credentialKind: users.credentialKind })
      .from(users)
      .where(eq(users.id, p.userId));
    if (!user || !(await this.hasher.verify(user.credentialHash, input.currentSecret))) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    const kind = user.credentialKind ?? 'password';
    const check = secretSchemaFor(kind).safeParse(input.newSecret);
    if (!check.success) {
      throw new AppError('VALIDATION_FAILED', { fields: { newSecret: check.error.issues[0]?.message ?? 'errors.validation.invalid' } });
    }
    await tx
      .update(users)
      .set({ credentialHash: await this.hasher.hash(input.newSecret), updatedAt: new Date() })
      .where(eq(users.id, p.userId));
    await this.sessions.revokeAllForUser(p.userId, p.sessionId);
    await this.audit.record({ action: 'user.credential_changed', entityType: 'user', entityId: p.userId });
  }

  async acceptInvite(input: InviteAcceptDto): Promise<IssuedLogin> {
    const parsed = parseOpaqueToken(input.token);
    if (!parsed) throw new AppError('TOKEN_INVALID');
    const credentialHash = await this.hasher.hash(input.password);
    return this.db.withTenant(parsed.tenantId, null, async (tx) => {
      const { userId } = await this.oneTime.consume(input.token, 'invite');
      const [user] = await tx
        .update(users)
        .set({ credentialHash, credentialKind: 'password', status: 'active', emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.status, 'invited')))
        .returning();
      if (!user || user.kind !== 'staff') throw new AppError('TOKEN_INVALID');
      await this.audit.record({ action: 'user.invite_accepted', entityType: 'user', entityId: userId, actorUserId: userId });
      return this.auth.issueLogin(user, input.client);
    });
  }

  /** Creates an invite token and mails it. Runs inside the current tenant transaction. */
  async issueInvite(input: { tenantId: string; userId: string; email: string; fullName: string }): Promise<void> {
    const [tenant] = await this.db.tx().select({ name: tenants.name }).from(tenants).where(eq(tenants.id, input.tenantId));
    const token = await this.oneTime.create({ tenantId: input.tenantId, userId: input.userId, purpose: 'invite' });
    await this.auth.sendMail(
      inviteMail({ to: input.email, fullName: input.fullName, orgName: tenant?.name ?? '', webUrl: this.config.WEB_URL, token }),
    );
  }

  /** Admin-triggered staff reset: mails a reset link. Runs inside the current tenant transaction. */
  async issuePasswordReset(input: { tenantId: string; userId: string; email: string; fullName: string }): Promise<void> {
    const token = await this.oneTime.create({ tenantId: input.tenantId, userId: input.userId, purpose: 'password_reset' });
    await this.auth.sendMail(passwordResetMail({ to: input.email, fullName: input.fullName, webUrl: this.config.WEB_URL, token }));
  }
}
