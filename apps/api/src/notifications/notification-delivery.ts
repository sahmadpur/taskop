import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { NotificationTargetKind, NotificationType, PushData } from '@taskop/contracts';
import { and, count, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { sanitiseForLog } from '../common/error.filter';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { DbService, type Tx } from '../db/db.service';
import { notificationDeliveries, notifications, pushDevices, users } from '../db/schema';
import { MAILER, type Mailer } from '../mail/mailer';
import { JobsService } from '../scheduling/jobs.service';
import { notificationMail } from './notification-templates';
import { PUSH_SENDER, type PushMessage, type PushReceipt, type PushSender, type PushTicket } from './push-sender';
import { type DeliverJob, failureText, NOTIFICATION_LIMITS, NOTIFICATION_QUEUES } from './queues';

/** Spec §6.1 step 5: these push with high priority. */
export const HIGH_PRIORITY_TYPES: ReadonlySet<NotificationType> = new Set(['checklist.overdue', 'problem.critical', 'task.overdue']);

/** Errors worth an operator's attention (tickets and receipts); every such error fails the row without retry (Spec decision 9). */
export const LOUD_TICKET_ERRORS: ReadonlySet<string> = new Set(['InvalidCredentials', 'MessageTooBig']);

/** The last_error of a refused push ticket or receipt, e.g. "DeviceNotRegistered: …". At most 500 characters. */
export function ticketErrorText(failure: Extract<PushTicket | PushReceipt, { ok: false }>): string {
  return `${failure.error ?? 'Error'}: ${failure.message}`.slice(0, 500);
}

/** Stops pushing to a device Expo reports as gone (DeviceNotRegistered); a later token claim re-enables it. */
export async function disableDevice(tx: Tx, deviceId: string, now: Date): Promise<void> {
  await tx.update(pushDevices).set({ disabledAt: now }).where(and(eq(pushDevices.id, deviceId), isNull(pushDevices.disabledAt)));
}

/** Unread inbox rows per user (the push badge); users without any are missing from the map. */
export async function unreadCounts(tx: Tx, userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!userIds.length) return out;
  const rows = await tx
    .select({ userId: notifications.userId, n: count() })
    .from(notifications)
    .where(and(inArray(notifications.userId, [...new Set(userIds)]), isNull(notifications.readAt)))
    .groupBy(notifications.userId);
  for (const r of rows) out.set(r.userId, r.n);
  return out;
}

/** One user's unread inbox rows. */
export async function unreadCount(tx: Tx, userId: string): Promise<number> {
  return (await unreadCounts(tx, [userId])).get(userId) ?? 0;
}

/**
 * The result of one delivery attempt. `retry` is a temporary failure: the row stays queued for another attempt until
 * this one is the 5th, which fails it. `skipped` is not an attempt.
 */
type AttemptResult =
  | { status: 'sent'; providerRef: string | null }
  | { status: 'failed'; error: string }
  | { status: 'retry'; error: string }
  | { status: 'skipped' };

interface Claimed {
  id: string;
  channel: 'push' | 'email';
  deviceId: string | null;
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  targetKind: NotificationTargetKind;
  targetId: string | null;
  targetDate: string | null;
  userActive: boolean;
  email: string | null;
  emailNotifications: boolean;
  expoToken: string | null;
  deviceDisabled: boolean;
}

interface PushItem extends Claimed {
  expoToken: string;
  badge: number;
}

interface EmailItem extends Claimed {
  email: string;
}

/** A 5xx SMTP reply is permanent (spec §6.6); connection errors and 4xx are worth a retry. */
const permanentSmtp = (e: unknown): boolean => {
  const code = (e as { responseCode?: unknown } | null)?.responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
};

/** Spec §6.1 step 5: claimed queued rows → Expo push (one request per job) or one email. */
@Injectable()
export class NotificationDelivery implements OnModuleInit {
  private readonly logger = new Logger('NotificationDelivery');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.jobs.defineWorker<DeliverJob>(NOTIFICATION_QUEUES.deliver, (job) => this.run(job), {
      retryLimit: NOTIFICATION_LIMITS.maxAttempts,
      deadLetter: NOTIFICATION_QUEUES.dead,
    });
  }

  /**
   * Claims the rows in a transaction that commits before Expo or SMTP is called, so an overlapping run (a sweep
   * re-send, a pg-boss retry) sends nothing twice; the results are written in a second transaction.
   */
  async run(job: DeliverJob): Promise<void> {
    const claimedAt = this.clock.now();
    const { push, email } = await this.db.withTenant(job.tenantId, null, () => this.claim(job.deliveryIds, claimedAt));
    if (push.length) await this.sendPush(job, push, claimedAt);
    for (const item of email) await this.sendEmail(job, item, claimedAt);
  }

  /**
   * Queued rows that nobody claimed in the last 5 minutes (a crashed run's claim expires, and the sweep re-queues by
   * coalesce(claimed_at, updated_at)). Rows that can no longer go out are marked skipped here.
   */
  private async claim(ids: string[], claimedAt: Date): Promise<{ push: PushItem[]; email: EmailItem[] }> {
    const tx = this.db.tx();
    const expired = new Date(+claimedAt - NOTIFICATION_LIMITS.deliverStaleMinutes * 60_000);
    const claimed = await tx
      .update(notificationDeliveries)
      .set({ claimedAt })
      .where(
        and(
          inArray(notificationDeliveries.id, ids),
          eq(notificationDeliveries.status, 'queued'),
          or(isNull(notificationDeliveries.claimedAt), lt(notificationDeliveries.claimedAt, expired)),
        ),
      )
      .returning({ id: notificationDeliveries.id });
    if (!claimed.length) return { push: [], email: [] };

    const rows: Claimed[] = (
      await tx
        .select({
          id: notificationDeliveries.id,
          channel: notificationDeliveries.channel,
          deviceId: notificationDeliveries.deviceId,
          notificationId: notifications.id,
          userId: notifications.userId,
          type: notifications.type,
          title: notifications.title,
          body: notifications.body,
          targetKind: notifications.targetKind,
          targetId: notifications.targetId,
          targetDate: notifications.targetDate,
          userStatus: users.status,
          email: users.email,
          emailNotifications: users.emailNotifications,
          expoToken: pushDevices.expoToken,
          disabledAt: pushDevices.disabledAt,
        })
        .from(notificationDeliveries)
        .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
        .innerJoin(users, eq(users.id, notifications.userId))
        .leftJoin(pushDevices, eq(pushDevices.id, notificationDeliveries.deviceId))
        .where(inArray(notificationDeliveries.id, claimed.map((c) => c.id)))
        .orderBy(notificationDeliveries.id)
    ).map(({ userStatus, disabledAt, ...r }) => ({
      ...r,
      type: r.type as NotificationType,
      userActive: userStatus === 'active',
      deviceDisabled: disabledAt !== null,
    }));
    const skip = (r: Claimed) => !r.userActive || (r.channel === 'push' ? !r.expoToken || r.deviceDisabled : !r.email || !r.emailNotifications);
    const skipped = rows.filter(skip).map((r) => r.id);
    if (skipped.length) await this.record(tx, skipped, { status: 'skipped' }, claimedAt);
    const live = rows.filter((r) => !skip(r));
    const pushRows = live.filter((r) => r.channel === 'push');
    const badges = await unreadCounts(tx, pushRows.map((r) => r.userId));
    return {
      push: pushRows.map((r) => ({ ...r, expoToken: r.expoToken!, badge: badges.get(r.userId) ?? 0 })),
      email: live.filter((r): r is EmailItem => r.channel === 'email'),
    };
  }

  private async sendPush(job: DeliverJob, items: PushItem[], claimedAt: Date): Promise<void> {
    const messages: PushMessage[] = items.map((i) => {
      const data: PushData = {
        notificationId: i.notificationId,
        userId: i.userId,
        tenantId: job.tenantId,
        type: i.type,
        targetKind: i.targetKind,
        targetId: i.targetId,
        targetDate: i.targetDate,
      };
      return {
        to: i.expoToken,
        title: i.title,
        body: i.body,
        data,
        sound: 'default',
        channelId: 'default',
        priority: HIGH_PRIORITY_TYPES.has(i.type) ? 'high' : 'default',
        badge: i.badge,
      };
    });
    let tickets: PushTicket[];
    try {
      tickets = await this.push.send(messages);
    } catch (e) {
      await this.failedAttempt(job, items.map((i) => i.id), e, claimedAt);
      return;
    }
    await this.db.withTenant(job.tenantId, null, async (tx) => {
      const now = this.clock.now();
      for (const [index, item] of items.entries()) {
        const ticket = tickets[index];
        if (ticket?.ok) {
          await this.record(tx, [item.id], { status: 'sent', providerRef: ticket.id }, claimedAt);
          continue;
        }
        const error = ticket ? ticketErrorText(ticket) : 'Error: no ticket';
        await this.record(tx, [item.id], { status: 'failed', error }, claimedAt);
        if (ticket?.error === 'DeviceNotRegistered' && item.deviceId) await disableDevice(tx, item.deviceId, now);
        if (ticket?.error && LOUD_TICKET_ERRORS.has(ticket.error)) this.logger.error(`Expo refused delivery ${item.id}: ${error}`);
      }
    });
  }

  private async sendEmail(job: DeliverJob, item: EmailItem, claimedAt: Date): Promise<void> {
    let result: AttemptResult;
    try {
      await this.mailer.send(notificationMail({ to: item.email, webUrl: this.config.WEB_URL, notification: item }));
      result = { status: 'sent', providerRef: null };
    } catch (e) {
      if (!permanentSmtp(e)) {
        await this.failedAttempt(job, [item.id], e, claimedAt);
        return;
      }
      result = { status: 'failed', error: failureText(e) };
    }
    await this.db.withTenant(job.tenantId, null, (tx) => this.record(tx, [item.id], result, claimedAt));
  }

  /**
   * One attempt for every row of a request that failed as a whole (HTTP, SMTP connection). Below the 5th the claim is
   * released and the job throws, so pg-boss retries it; the 5th fails the rows and dead-letters them.
   */
  private async failedAttempt(job: DeliverJob, ids: string[], e: unknown, claimedAt: Date): Promise<void> {
    const error = failureText(e);
    const rows = await this.db.withTenant(job.tenantId, null, (tx) => this.record(tx, ids, { status: 'retry', error }, claimedAt));
    const failed = rows.filter((r) => r.status === 'failed').map((r) => r.id);
    if (failed.length) {
      this.logger.error(sanitiseForLog(e, null), `Delivery of ${failed.length} notification(s) failed ${NOTIFICATION_LIMITS.maxAttempts} times; giving up`);
      try {
        await this.jobs.send(NOTIFICATION_QUEUES.dead, { queue: NOTIFICATION_QUEUES.deliver, tenantId: job.tenantId, deliveryIds: failed, error });
      } catch (sendError) {
        // The rows keep status failed and last_error, so they are still on record without the dead letter.
        this.logger.error(sanitiseForLog(sendError, null), `Dead-lettering ${failed.length} failed notification deliveries failed`);
      }
    }
    if (rows.some((r) => r.status === 'queued')) throw e;
  }

  /**
   * The one write of an attempt's result: status, attempts, last_error, sent_at and provider_ref, and the claim is
   * released. Only rows this run still holds (queued, claimed at `claimedAt`) change; returns them with their new status.
   */
  private async record(tx: Tx, ids: string[], result: AttemptResult, claimedAt: Date): Promise<{ id: string; status: string }[]> {
    const d = notificationDeliveries;
    const now = this.clock.now();
    const attempted = { attempts: sql`${d.attempts} + 1`, claimedAt: null, updatedAt: now };
    const set =
      result.status === 'skipped'
        ? { status: 'skipped' as const, claimedAt: null, updatedAt: now }
        : result.status === 'sent'
          ? { ...attempted, status: 'sent' as const, providerRef: result.providerRef, sentAt: now, lastError: null }
          : result.status === 'failed'
            ? { ...attempted, status: 'failed' as const, lastError: result.error }
            : {
                ...attempted,
                lastError: result.error,
                status: sql`case when ${d.attempts} + 1 >= ${NOTIFICATION_LIMITS.maxAttempts} then 'failed'::notification_delivery_status else ${d.status} end`,
              };
    return tx
      .update(d)
      .set(set)
      .where(and(inArray(d.id, ids), eq(d.status, 'queued'), eq(d.claimedAt, claimedAt)))
      .returning({ id: d.id, status: d.status });
  }
}
