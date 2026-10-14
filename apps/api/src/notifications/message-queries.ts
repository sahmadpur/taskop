import { Injectable } from '@nestjs/common';
import {
  aggregateDeliveryStatus,
  type DeliveryChannel,
  type DeliveryCounts,
  type DeliveryStatus,
  type MessageDetail,
  type MessageRecipient,
  type MessageSummary,
  type Page,
} from '@taskop/contracts';
import { and, asc, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { notificationDeliveries, notificationEvents, notifications, sites, teams, users } from '../db/schema';
import type { ManualPayload } from './payloads';

const zero = (): DeliveryCounts => ({ queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0 });

interface EventRow {
  id: string;
  payload: unknown;
  createdAt: Date;
  processedAt: Date | null;
  senderId: string | null;
  senderName: string | null;
}

/** Spec §6.4 "Manual messages" reads. Counts are per recipient, using aggregateDeliveryStatus's order. */
@Injectable()
export class MessageQueries {
  constructor(private readonly db: DbService) {}

  async list(p: Principal, q: { cursor?: string; limit: number }): Promise<Page<MessageSummary>> {
    const conds: (SQL | undefined)[] = [this.visible(p)];
    if (q.cursor) {
      conds.push(sql`(${notificationEvents.createdAt}, ${notificationEvents.id}) < (select c.created_at, c.id from notification_events c where c.id = ${q.cursor})`);
    }
    const rows = await this.select()
      .where(and(...conds))
      .orderBy(desc(notificationEvents.createdAt), desc(notificationEvents.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    return { items: await this.summaries(page), nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null };
  }

  async summary(p: Principal, id: string): Promise<MessageSummary> {
    const [row] = await this.select().where(and(eq(notificationEvents.id, id), this.visible(p)));
    if (!row) throw new AppError('NOT_FOUND');
    return (await this.summaries([row]))[0]!;
  }

  async detail(p: Principal, id: string): Promise<MessageDetail> {
    const summary = await this.summary(p, id);
    const tx = this.db.tx();
    const [ev] = await tx.select({ payload: notificationEvents.payload }).from(notificationEvents).where(eq(notificationEvents.id, id));
    const payload = ev!.payload as ManualPayload;
    const targets = {
      users: payload.userIds.length
        ? await tx.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, payload.userIds)).orderBy(asc(users.fullName), asc(users.id))
        : [],
      teams: payload.teamIds.length
        ? await tx.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, payload.teamIds)).orderBy(asc(teams.name), asc(teams.id))
        : [],
      sites: payload.siteIds.length
        ? await tx.select({ id: sites.id, name: sites.name }).from(sites).where(inArray(sites.id, payload.siteIds)).orderBy(asc(sites.name), asc(sites.id))
        : [],
    };
    const rows = await tx
      .select({ id: notifications.id, userId: users.id, fullName: users.fullName, readAt: notifications.readAt })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .where(eq(notifications.eventId, id))
      .orderBy(asc(users.fullName), asc(users.id));
    const deliveries = rows.length
      ? await tx
          .select({ notificationId: notificationDeliveries.notificationId, channel: notificationDeliveries.channel, status: notificationDeliveries.status, lastError: notificationDeliveries.lastError })
          .from(notificationDeliveries)
          .where(inArray(notificationDeliveries.notificationId, rows.map((r) => r.id)))
          .orderBy(asc(notificationDeliveries.id))
      : [];
    const channel = (notificationId: string, c: DeliveryChannel) => {
      const mine = deliveries.filter((d) => d.notificationId === notificationId && d.channel === c);
      const status = aggregateDeliveryStatus(mine.map((d) => d.status));
      const lastError = (mine.find((d) => d.status === status && d.lastError) ?? mine.find((d) => d.lastError))?.lastError ?? null;
      return { status, lastError, devices: mine.length };
    };
    const recipients: MessageRecipient[] = rows.map((r) => {
      const push = channel(r.id, 'push');
      const email = channel(r.id, 'email');
      return {
        user: { id: r.userId, fullName: r.fullName },
        readAt: r.readAt?.toISOString() ?? null,
        push: { status: push.status, devices: push.devices, lastError: push.lastError },
        email: { status: email.status, lastError: email.lastError },
      };
    });
    return { ...summary, targets, recipients };
  }

  /** Manual messages only; notifications.manage sees the tenant's, other senders their own (spec §6.4). */
  private visible(p: Principal): SQL {
    return and(eq(notificationEvents.type, 'manual'), p.permissions.has('notifications.manage') ? undefined : eq(notificationEvents.actorUserId, p.userId))!;
  }

  private select() {
    return this.db
      .tx()
      .select({
        id: notificationEvents.id,
        payload: notificationEvents.payload,
        createdAt: notificationEvents.createdAt,
        processedAt: notificationEvents.processedAt,
        senderId: users.id,
        senderName: users.fullName,
      })
      .from(notificationEvents)
      .leftJoin(users, eq(users.id, notificationEvents.actorUserId))
      .$dynamic();
  }

  private async summaries(rows: EventRow[]): Promise<MessageSummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const tx = this.db.tx();
    const totals = new Map(
      (
        await tx
          .select({ eventId: notifications.eventId, recipients: count(), read: count(notifications.readAt) })
          .from(notifications)
          .where(inArray(notifications.eventId, ids))
          .groupBy(notifications.eventId)
      ).map((r) => [r.eventId, r]),
    );
    // One status per recipient and channel (the best of its deliveries), then counted per message.
    const rollup = await tx.execute<{ event_id: string; channel: DeliveryChannel; status: DeliveryStatus; n: number }>(sql`
      select x.event_id, x.channel, x.status, count(*)::int as n
        from (select notifications.event_id, d.channel,
                     (array_agg(d.status order by array_position(array['delivered','sent','queued','failed','skipped']::text[], d.status::text)))[1] as status
                from notifications
                join notification_deliveries d on d.notification_id = notifications.id
               where ${inArray(notifications.eventId, ids)}
               group by notifications.event_id, notifications.id, d.channel) x
       group by x.event_id, x.channel, x.status`);
    const counts = new Map<string, { push: DeliveryCounts; email: DeliveryCounts }>();
    for (const r of rollup.rows) {
      const entry = counts.get(r.event_id) ?? { push: zero(), email: zero() };
      entry[r.channel][r.status] = r.n;
      counts.set(r.event_id, entry);
    }
    return rows.map((r) => {
      const payload = r.payload as ManualPayload;
      const total = totals.get(r.id);
      const c = counts.get(r.id) ?? { push: zero(), email: zero() };
      return {
        id: r.id,
        title: payload.title,
        body: payload.body,
        sender: r.senderId ? { id: r.senderId, fullName: r.senderName! } : null,
        sentAt: r.createdAt.toISOString(),
        emailRequested: payload.email,
        processed: r.processedAt !== null,
        recipientCount: total?.recipients ?? 0,
        readCount: total?.read ?? 0,
        push: c.push,
        email: c.email,
      };
    });
  }
}
