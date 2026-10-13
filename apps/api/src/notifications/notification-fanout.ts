import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { NotificationRuleDto, NotificationType } from '@taskop/contracts';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { sanitiseForLog } from '../common/error.filter';
import { DbService } from '../db/db.service';
import { notificationDeliveries, notificationEvents, notifications, pushDevices, users } from '../db/schema';
import { JobsService } from '../scheduling/jobs.service';
import { NotificationRecipients } from './notification-recipients';
import { NotificationTargets } from './notification-targets';
import { renderNotification } from './notification-templates';
import { type DeliverJob, deliveryJobs, type FanoutJob, failureText, NOTIFICATION_LIMITS, NOTIFICATION_QUEUES } from './queues';
import { NotificationRules } from './rules.service';

export const NOTIFICATION_OUTCOMES = ['fanned_out', 'disabled', 'no_recipients', 'target_gone'] as const;
export type NotificationOutcome = (typeof NOTIFICATION_OUTCOMES)[number];
export type FanoutResult = NotificationOutcome | 'already_processed' | 'missing' | 'failed';

type DeliveryInsert = typeof notificationDeliveries.$inferInsert;

/** Spec §6.1 step 4: one event → inbox rows and delivery rows, in one tenant transaction. */
@Injectable()
export class NotificationFanout implements OnModuleInit {
  private readonly logger = new Logger('NotificationFanout');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly rules: NotificationRules,
    private readonly targets: NotificationTargets,
    private readonly recipients: NotificationRecipients,
  ) {}

  onModuleInit(): void {
    this.jobs.defineWorker<FanoutJob>(
      NOTIFICATION_QUEUES.fanout,
      async (job) => {
        await this.run(job);
      },
      { retryLimit: NOTIFICATION_LIMITS.maxAttempts, deadLetter: NOTIFICATION_QUEUES.dead },
    );
  }

  /** Throws below the 5th failed attempt so pg-boss retries with backoff; gives up on the 5th (Spec decision 1). */
  async run(job: FanoutJob): Promise<FanoutResult> {
    try {
      return await this.db.withTenant(job.tenantId, null, () => this.fanOut(job));
    } catch (e) {
      const error = failureText(e);
      const attempts = await this.countFailure(job, error);
      if (attempts === null || attempts < NOTIFICATION_LIMITS.maxAttempts) throw e;
      this.logger.error(sanitiseForLog(e, null), `Fan-out of notification event ${job.eventId} failed ${attempts} times; giving up`);
      try {
        await this.jobs.send(NOTIFICATION_QUEUES.dead, { queue: NOTIFICATION_QUEUES.fanout, ...job, error });
      } catch (sendError) {
        // The event keeps last_error and attempts = 5, so it is still on record without the dead letter.
        this.logger.error(sanitiseForLog(sendError, null), `Dead-lettering notification event ${job.eventId} failed`);
      }
      return 'failed';
    }
  }

  /** In its own transaction: the failed one rolled back. Null when it cannot be recorded (pg-boss then retries). */
  private async countFailure(job: FanoutJob, error: string): Promise<number | null> {
    try {
      return await this.db.withTenant(job.tenantId, null, async (tx) => {
        const [r] = await tx
          .update(notificationEvents)
          .set({ attempts: sql`${notificationEvents.attempts} + 1`, lastError: error })
          .where(and(eq(notificationEvents.id, job.eventId), isNull(notificationEvents.processedAt)))
          .returning({ attempts: notificationEvents.attempts });
        return r?.attempts ?? null;
      });
    } catch {
      return null;
    }
  }

  private async fanOut(job: FanoutJob): Promise<FanoutResult> {
    const tx = this.db.tx();
    // Locked: a second run for the same event (sweep re-send) waits, then sees processed_at.
    const [ev] = await tx.select().from(notificationEvents).where(eq(notificationEvents.id, job.eventId)).for('update');
    if (!ev) return 'missing';
    if (ev.processedAt) return 'already_processed';
    const type = ev.type as NotificationType;
    const finish = async (outcome: NotificationOutcome): Promise<NotificationOutcome> => {
      await tx
        .update(notificationEvents)
        .set({ processedAt: this.clock.now(), outcome, attempts: sql`${notificationEvents.attempts} + 1`, lastError: null })
        .where(eq(notificationEvents.id, ev.id));
      return outcome;
    };

    let rule: NotificationRuleDto | null = null;
    if (type !== 'manual') {
      rule = await this.rules.effective(type);
      if (!rule.enabled) return finish('disabled');
    }
    const target = await this.targets.load(type, ev.payload, ev.actorUserId);
    if (!target) return finish('target_gone');
    const userIds = target.kind === 'manual' ? await this.recipients.forMessage(target) : await this.recipients.resolve(rule!, target, ev.actorUserId);
    if (!userIds.length) return finish('no_recipients');

    const rendered = renderNotification(type, target);
    const push = target.kind === 'manual' ? true : rule!.push;
    const email = target.kind === 'manual' ? target.email : rule!.email;
    const now = this.clock.now();
    const inbox = await tx
      .insert(notifications)
      .values(userIds.map((userId) => ({ tenantId: ev.tenantId, eventId: ev.id, userId, type, ...rendered, createdAt: now })))
      .onConflictDoNothing({ target: [notifications.eventId, notifications.userId] })
      .returning({ id: notifications.id, userId: notifications.userId });
    const rows: DeliveryInsert[] = [];
    // claimed_at stays null: the deliver worker claims rows before calling a provider.
    const delivery = (notificationId: string, channel: 'push' | 'email', deviceId: string | null): DeliveryInsert => ({
      tenantId: ev.tenantId,
      notificationId,
      channel,
      deviceId,
      createdAt: now,
      updatedAt: now,
    });
    if (inbox.length && push) {
      const devices = await tx
        .select({ id: pushDevices.id, userId: pushDevices.userId })
        .from(pushDevices)
        .where(and(inArray(pushDevices.userId, inbox.map((n) => n.userId)), isNull(pushDevices.disabledAt)))
        .orderBy(asc(pushDevices.id));
      for (const n of inbox) for (const d of devices) if (d.userId === n.userId) rows.push(delivery(n.id, 'push', d.id));
    }
    if (inbox.length && email) {
      const mailable = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, inbox.map((n) => n.userId)), isNotNull(users.email), eq(users.emailNotifications, true)));
      const ok = new Set(mailable.map((u) => u.id));
      for (const n of inbox) if (ok.has(n.userId)) rows.push(delivery(n.id, 'email', null));
    }
    const created = rows.length
      ? await tx.insert(notificationDeliveries).values(rows).returning({ id: notificationDeliveries.id, channel: notificationDeliveries.channel })
      : [];
    const outcome = await finish('fanned_out');
    const jobs = deliveryJobs(ev.tenantId, created);
    if (jobs.length) this.db.afterCommit(() => this.queueDeliveries(ev.id, jobs));
    return outcome;
  }

  /** After commit. A lost send is picked up by notifications.sweep (rows queued for over 5 minutes). */
  private async queueDeliveries(eventId: string, jobs: DeliverJob[]): Promise<void> {
    for (const j of jobs) {
      try {
        await this.jobs.send(NOTIFICATION_QUEUES.deliver, j);
      } catch (e) {
        this.logger.error(sanitiseForLog(e, null), `Queueing ${j.deliveryIds.length} deliveries of notification event ${eventId} failed; the sweep will retry`);
      }
    }
  }
}
