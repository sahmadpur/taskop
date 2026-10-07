import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LoginResult } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../common/app-error';
import { currentRequestMeta } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { roles, tenants, users } from '../db/schema';
import { MAILER, type Mailer, type MailMessage } from '../mail/mailer';
import { verifyEmailMail } from '../mail/templates';
import { seedTenantDefaults } from '../tenancy/bootstrap';
import { parseOpaqueToken } from './crypto/opaque-token';
import { PasswordHasher } from './crypto/password-hasher';
import { TokenService } from './crypto/token.service';
import type { SignupDto } from './dto';
import { MeService } from './me.service';
import { OneTimeTokenService } from './one-time-token.service';
import { RateLimitService } from './rate-limit.service';
import { type Client, SessionService } from './session.service';

export interface IssuedLogin {
  result: LoginResult;
  refreshToken: string;
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
      client,
    };
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
