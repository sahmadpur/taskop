import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { sanitiseForLog } from '../common/error.filter';
import { eachTenant, perTenant, tenantsWith } from '../common/per-tenant';
import { DbService } from '../db/db.service';
import { notificationDeliveries, notificationEvents, notifications, occurrences, pushDevices } from '../db/schema';
import { JobsService } from '../scheduling/jobs.service';
import { disableDevice, LOUD_TICKET_ERRORS, ticketErrorText } from './notification-delivery';
import { NotificationEvents } from './notification-events';
import { PUSH_SENDER, type PushReceipt, type PushSender } from './push-sender';
import { type DeliverJob, deliveryJobs, type FanoutJob, NOTIFICATION_LIMITS, NOTIFICATION_QUEUES } from './queues';
import { NotificationRules } from './rules.service';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Spec §6.3 cron schedules (UTC). */
export const NOTIFICATION_CRONS = {
  scan: '* * * * *',
  receipts: '*/15 * * * *',
  sweep: '*/5 * * * *',
  cleanup: '15 4 * * *',
} as const;

/** The last_error of a delivery whose run died between its claim and its result. */
const INTERRUPTED = 'delivery interrupted';

/** The notification crons, per tenant. Expo and pg-boss are called between tenant transactions, never inside one. */
@Injectable()
export class NotificationJobs implements OnModuleInit {
  private readonly logger = new Logger('NotificationJobs');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    private readonly rules: NotificationRules,
    private readonly events: NotificationEvents,
  ) {}

  onModuleInit(): void {
    this.jobs.define({ name: NOTIFICATION_QUEUES.scan, cron: NOTIFICATION_CRONS.scan, handler: (ids) => this.scanAll(ids) });
    this.jobs.define({ name: NOTIFICATION_QUEUES.receipts, cron: NOTIFICATION_CRONS.receipts, handler: (ids) => this.receiptsAll(ids) });
    this.jobs.define({ name: NOTIFICATION_QUEUES.sweep, cron: NOTIFICATION_CRONS.sweep, handler: (ids) => this.sweepAll(ids) });
    this.jobs.define({ name: NOTIFICATION_QUEUES.cleanup, cron: NOTIFICATION_CRONS.cleanup, handler: (ids) => this.cleanupAll(ids) });
  }

  /**
   * notifications.scan (spec §3.4): no status changes when a run opens or nears its due time, so this finds them.
   * Only for enabled rules; dedupe keys make each fire at most once. Returns the events actually recorded.
   */
  async scanAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const opened = new Date(+now - NOTIFICATION_LIMITS.availableWindowMinutes * MINUTE);
    // Pending runs that opened in the last 15 minutes (even if their window has since closed), or are still open.
    const tenantIds = await tenantsWith(
      this.db,
      sql`select distinct tenant_id from occurrences
          where status = 'pending' and starts_at <= ${now} and (starts_at >= ${opened} or due_at > ${now})`,
      only,
    );
    return perTenant(this.db, this.logger, 'Notification scan', tenantIds, async () => {
      const tx = this.db.tx();
      const notYet = (type: 'checklist.available' | 'checklist.due_soon') =>
        sql`not exists (select 1 from notification_events e where e.dedupe_key = ${`${type}:`} || ${occurrences.id}::text)`;
      let recorded = 0;
      const available = await this.rules.effective('checklist.available');
      if (available.enabled) {
        // No due_at filter: after downtime a short run that opened in the window is still announced.
        const rows = await tx
          .select({ id: occurrences.id })
          .from(occurrences)
          .where(and(eq(occurrences.status, 'pending'), lte(occurrences.startsAt, now), gte(occurrences.startsAt, opened), notYet('checklist.available')))
          .orderBy(occurrences.startsAt, occurrences.id);
        for (const r of rows) {
          if (await this.events.record('checklist.available', { occurrenceId: r.id }, null, `checklist.available:${r.id}`)) recorded++;
        }
      }
      const dueSoon = await this.rules.effective('checklist.due_soon');
      if (dueSoon.enabled && dueSoon.leadMinutes) {
        const lead = dueSoon.leadMinutes;
        const rows = await tx
          .select({ id: occurrences.id })
          .from(occurrences)
          .where(
            and(
              eq(occurrences.status, 'pending'),
              gt(occurrences.dueAt, now),
              lte(occurrences.dueAt, new Date(+now + lead * MINUTE)),
              // A window shorter than the lead: the available notice covers it.
              sql`${occurrences.dueAt} - make_interval(mins => ${lead}) > ${occurrences.startsAt}`,
              notYet('checklist.due_soon'),
            ),
          )
          .orderBy(occurrences.dueAt, occurrences.id);
        for (const r of rows) {
          if (await this.events.record('checklist.due_soon', { occurrenceId: r.id }, null, `checklist.due_soon:${r.id}`)) recorded++;
        }
      }
      return recorded;
    });
  }

  /** notifications.receipts: Expo receipts for pushes sent 15 min–24 h ago (Spec decision 10). Returns the rows settled. */
  async receiptsAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const latest = new Date(+now - NOTIFICATION_LIMITS.receiptDelayMinutes * MINUTE);
    const earliest = new Date(+now - NOTIFICATION_LIMITS.receiptMaxAgeHours * HOUR);
    const tenantIds = await tenantsWith(
      this.db,
      sql`select distinct tenant_id from notification_deliveries
          where channel = 'push' and status = 'sent' and sent_at <= ${latest} and sent_at > ${earliest} and provider_ref is not null`,
      only,
    );
    return eachTenant(this.logger, 'Notification receipts', tenantIds, (tenantId) => this.receiptsTenant(tenantId, latest, earliest));
  }

  /** Reads the candidates in one transaction, asks Expo with none open, and writes the results in a second one. */
  private async receiptsTenant(tenantId: string, latest: Date, earliest: Date): Promise<number> {
    const d = notificationDeliveries;
    const rows = await this.db.withTenant(tenantId, null, (tx) =>
      tx
        .select({ id: d.id, ref: d.providerRef, deviceId: d.deviceId })
        .from(d)
        .where(and(eq(d.channel, 'push'), eq(d.status, 'sent'), lte(d.sentAt, latest), gt(d.sentAt, earliest), isNotNull(d.providerRef)))
        .orderBy(d.id),
    );
    if (!rows.length) return 0;
    const receipts = await this.push.receipts(rows.map((r) => r.ref!));
    const ok: string[] = [];
    const refused: { id: string; deviceId: string | null; receipt: Extract<PushReceipt, { ok: false }> }[] = [];
    for (const r of rows) {
      const receipt = receipts.get(r.ref!);
      if (receipt?.ok) ok.push(r.id);
      else if (receipt) refused.push({ id: r.id, deviceId: r.deviceId, receipt });
    }
    if (!ok.length && !refused.length) return 0;
    return this.db.withTenant(tenantId, null, async (tx) => {
      const now = this.clock.now();
      // status = 'sent' still: a row settled since the read is left alone.
      const delivered = ok.length
        ? await tx.update(d).set({ status: 'delivered', updatedAt: now }).where(and(inArray(d.id, ok), eq(d.status, 'sent'))).returning({ id: d.id })
        : [];
      let failed = 0;
      for (const { id, deviceId, receipt } of refused) {
        const error = ticketErrorText(receipt);
        const [row] = await tx.update(d).set({ status: 'failed', lastError: error, updatedAt: now }).where(and(eq(d.id, id), eq(d.status, 'sent'))).returning({ id: d.id });
        if (!row) continue;
        failed++;
        if (receipt.error === 'DeviceNotRegistered' && deviceId) await disableDevice(tx, deviceId, now);
        if (receipt.error && LOUD_TICKET_ERRORS.has(receipt.error)) this.logger.error(`Expo receipt refused delivery ${id}: ${error}`);
      }
      return delivered.length + failed;
    });
  }

  /**
   * notifications.sweep: re-sends jobs that were lost (a crash between commit and send, a missed after-commit, a run that
   * died holding its claim). Returns the number of jobs sent.
   */
  async sweepAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const staleEvent = new Date(+now - NOTIFICATION_LIMITS.fanoutStaleMinutes * MINUTE);
    const staleDelivery = new Date(+now - NOTIFICATION_LIMITS.deliverStaleMinutes * MINUTE);
    const max = NOTIFICATION_LIMITS.maxAttempts;
    const tenantIds = await tenantsWith(
      this.db,
      sql`select tenant_id from notification_events where processed_at is null and attempts < ${max} and created_at <= ${staleEvent}
          union
          select tenant_id from notification_deliveries
          where status = 'queued' and attempts < ${max} and coalesce(claimed_at, updated_at) <= ${staleDelivery}`,
      only,
    );
    return eachTenant(this.logger, 'Notification sweep', tenantIds, async (tenantId) => {
      const { events, deliveries } = await this.db.withTenant(tenantId, null, () => this.sweepTenant(staleEvent, staleDelivery));
      let sent = 0;
      for (const e of events) {
        const job: FanoutJob = { tenantId, eventId: e.id };
        sent += await this.resend(NOTIFICATION_QUEUES.fanout, job, `fan-out of notification event ${e.id}`);
      }
      for (const job of deliveryJobs(tenantId, deliveries)) {
        sent += await this.resend(NOTIFICATION_QUEUES.deliver, job, `${job.deliveryIds.length} notification deliveries`);
      }
      return sent;
    });
  }

  /**
   * Events unprocessed for 2 minutes, and queued deliveries untouched for 5 (`updated_at` moves with every recorded
   * attempt, so a row pg-boss is backing off is not re-sent early). A claim older than 5 minutes belongs to a run that
   * died before its result: it counts as an attempt and is released, and the 5th such attempt fails the row.
   */
  private async sweepTenant(staleEvent: Date, staleDelivery: Date) {
    const tx = this.db.tx();
    const d = notificationDeliveries;
    const max = NOTIFICATION_LIMITS.maxAttempts;
    const events = await tx
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(and(isNull(notificationEvents.processedAt), lt(notificationEvents.attempts, max), lte(notificationEvents.createdAt, staleEvent)))
      .orderBy(notificationEvents.createdAt, notificationEvents.id);
    const interrupted = await tx
      .update(d)
      .set({
        attempts: sql`${d.attempts} + 1`,
        lastError: INTERRUPTED,
        claimedAt: null,
        updatedAt: this.clock.now(),
        status: sql`case when ${d.attempts} + 1 >= ${max} then 'failed'::notification_delivery_status else ${d.status} end`,
      })
      .where(and(eq(d.status, 'queued'), lt(d.attempts, max), isNotNull(d.claimedAt), lte(d.claimedAt, staleDelivery)))
      .returning({ id: d.id, channel: d.channel, status: d.status });
    const givenUp = interrupted.filter((r) => r.status === 'failed').length;
    if (givenUp) this.logger.error(`Delivery of ${givenUp} notification(s) was interrupted ${max} times; giving up`);
    const idle = await tx
      .select({ id: d.id, channel: d.channel })
      .from(d)
      .where(and(eq(d.status, 'queued'), lt(d.attempts, max), isNull(d.claimedAt), lte(d.updatedAt, staleDelivery)));
    const deliveries = [...interrupted.filter((r) => r.status === 'queued'), ...idle].sort((a, b) => (a.id < b.id ? -1 : 1));
    return { events, deliveries };
  }

  /** 1 when the job was queued; a failure is logged and left to the next sweep. */
  private async resend(queue: string, job: FanoutJob | DeliverJob, what: string): Promise<number> {
    try {
      return (await this.jobs.send(queue, job)) ? 1 : 0;
    } catch (e) {
      this.logger.error(sanitiseForLog(e, null), `Re-sending ${what} failed; the next sweep retries`);
      return 0;
    }
  }

  /** notifications.cleanup: 90-day retention of the inbox and processed events; 180-day idle devices are disabled. */
  async cleanupAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const retention = new Date(+now - NOTIFICATION_LIMITS.retentionDays * DAY);
    const idle = new Date(+now - NOTIFICATION_LIMITS.deviceIdleDays * DAY);
    const tenantIds = await tenantsWith(this.db, sql`select id as tenant_id from tenants`, only);
    return perTenant(this.db, this.logger, 'Notification cleanup', tenantIds, async () => {
      const tx = this.db.tx();
      // Deliveries go with their notification (ON DELETE CASCADE).
      const inbox = await tx.delete(notifications).where(lt(notifications.createdAt, retention)).returning({ id: notifications.id });
      const events = await tx
        .delete(notificationEvents)
        .where(and(isNotNull(notificationEvents.processedAt), lt(notificationEvents.createdAt, retention)))
        .returning({ id: notificationEvents.id });
      const devices = await tx
        .update(pushDevices)
        .set({ disabledAt: now })
        .where(and(isNull(pushDevices.disabledAt), lt(pushDevices.lastSeenAt, idle)))
        .returning({ id: pushDevices.id });
      return inbox.length + events.length + devices.length;
    });
  }
}
