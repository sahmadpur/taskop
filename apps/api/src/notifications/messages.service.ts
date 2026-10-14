import { Injectable } from '@nestjs/common';
import { MESSAGE_LIMITS, type MessagePreview, type MessageSummary, type MessageTargetOptions } from '@taskop/contracts';
import { and, asc, eq, ilike, inArray, ne, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { ScopeService } from '../common/scope.service';
import { escapeLike } from '../common/sql';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { sites, teams, users } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import type { SendMessageDto } from './dto';
import { MessageQueries } from './message-queries';
import { NotificationEvents } from './notification-events';
import { NotificationRecipients } from './notification-recipients';
import type { ManualPayload } from './payloads';

const unique = (ids: string[]) => [...new Set(ids)];

/** FR-15.08 (spec §6.4): messages to users, teams and sites inside the sender's data scope. */
@Injectable()
export class MessagesService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly siteScope: SchedulingScope,
    private readonly recipients: NotificationRecipients,
    private readonly events: NotificationEvents,
    private readonly audit: AuditService,
    private readonly queries: MessageQueries,
  ) {}

  /** The picker (Spec decision 13): active users but the sender, active teams with active members in scope, active sites in scope. */
  async options(p: Principal, q: string | undefined): Promise<MessageTargetOptions> {
    const tx = this.db.tx();
    const like = q ? `%${escapeLike(q)}%` : null;
    const people = await tx
      .select({ id: users.id, fullName: users.fullName, jobTitle: users.jobTitle })
      .from(users)
      .where(and(eq(users.status, 'active'), ne(users.id, p.userId), this.scope.usersFilter(p), like ? ilike(users.fullName, like) : undefined))
      .orderBy(asc(users.fullName), asc(users.id))
      .limit(50);
    const inScope = this.scope.usersFilter(p) ?? sql`true`;
    // "teams.id" is spelled out: in a single-table select drizzle renders a column interpolated into a selected SQL field
    // as a bare "id", which inside this subquery would resolve to users.id.
    const members = sql<number>`(select count(*)::int from user_teams ut join users on users.id = ut.user_id where ut.team_id = teams.id and users.status = 'active' and ${inScope})`;
    const groups = await tx
      .select({ id: teams.id, name: teams.name, memberCount: members })
      .from(teams)
      .where(and(eq(teams.active, true), sql`${members} > 0`, like ? ilike(teams.name, like) : undefined))
      .orderBy(asc(teams.name), asc(teams.id))
      .limit(50);
    const places = await tx
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.active, true), this.siteScope.writableSites(p)))
      .orderBy(asc(sites.name), asc(sites.id))
      .limit(200);
    return { users: people, teams: groups, sites: places };
  }

  async preview(p: Principal, input: SendMessageDto): Promise<MessagePreview> {
    await this.assertInScope(p, input);
    return { recipientCount: (await this.expand(p, input)).length };
  }

  async send(p: Principal, input: SendMessageDto): Promise<MessageSummary> {
    await this.assertInScope(p, input);
    const recipientCount = (await this.expand(p, input)).length;
    if (recipientCount === 0) throw new AppError('VALIDATION_FAILED', { fields: { userIds: 'notifications.issues.noRecipients' } });
    if (recipientCount > MESSAGE_LIMITS.maxRecipients) throw new AppError('VALIDATION_FAILED', { fields: { userIds: 'notifications.issues.tooManyRecipients' } });
    const payload: ManualPayload = {
      title: input.title,
      body: input.body,
      userIds: unique(input.userIds),
      teamIds: unique(input.teamIds),
      siteIds: unique(input.siteIds),
      email: input.email,
    };
    // create (not record): the sender must learn of a failure.
    const eventId = (await this.events.create('manual', payload, p.userId))!;
    await this.audit.record({
      action: 'notification.message_sent',
      entityType: 'notification_message',
      entityId: eventId,
      after: { title: payload.title, recipientCount, email: payload.email, userIds: payload.userIds, teamIds: payload.teamIds, siteIds: payload.siteIds },
    });
    return this.queries.summary(p, eventId);
  }

  private expand(p: Principal, input: SendMessageDto): Promise<string[]> {
    return this.recipients.expandMessage(p, { userIds: unique(input.userIds), teamIds: unique(input.teamIds), siteIds: unique(input.siteIds) });
  }

  /** Every selected id must be one the picker could offer (any status): otherwise 403. */
  private async assertInScope(p: Principal, input: SendMessageDto): Promise<void> {
    const tx = this.db.tx();
    const userIds = unique(input.userIds);
    if (userIds.length) {
      const found = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, userIds), this.scope.usersFilter(p)));
      if (found.length !== userIds.length) throw new AppError('FORBIDDEN');
    }
    const teamIds = unique(input.teamIds);
    if (teamIds.length) {
      const filter = this.scope.usersFilter(p);
      const inScope = filter ? sql`exists (select 1 from user_teams ut join users on users.id = ut.user_id where ut.team_id = ${teams.id} and ${filter})` : undefined;
      const found = await tx.select({ id: teams.id }).from(teams).where(and(inArray(teams.id, teamIds), inScope));
      if (found.length !== teamIds.length) throw new AppError('FORBIDDEN');
    }
    const siteIds = unique(input.siteIds);
    if (siteIds.length) {
      const found = await tx.select({ id: sites.id }).from(sites).where(and(inArray(sites.id, siteIds), this.siteScope.writableSites(p)));
      if (found.length !== siteIds.length) throw new AppError('FORBIDDEN');
    }
  }
}
