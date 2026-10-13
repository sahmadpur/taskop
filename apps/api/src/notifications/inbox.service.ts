import { Injectable } from '@nestjs/common';
import type { NotificationItem, NotificationType, Page, Preferences } from '@taskop/contracts';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { notifications, pushDevices, users } from '../db/schema';
import type { NotificationListQueryDto, RegisterPushDeviceDto, UpdatePreferencesDto } from './dto';
import { unreadCount } from './notification-delivery';

type InboxRow = typeof notifications.$inferSelect;

const toItem = (n: InboxRow): NotificationItem => ({
  id: n.id,
  type: n.type as NotificationType,
  title: n.title,
  body: n.body,
  targetKind: n.targetKind,
  targetId: n.targetId,
  targetDate: n.targetDate,
  createdAt: n.createdAt.toISOString(),
  readAt: n.readAt?.toISOString() ?? null,
});

/** Spec §6.4 "Current user": only ever the caller's own rows. */
@Injectable()
export class InboxService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
  ) {}

  /**
   * Newest first, keyset on (created_at, id) so rows of one instant never repeat or vanish between pages (Spec
   * decision 15). The sort spells out NULLS LAST so notifications_user_created_idx serves it.
   */
  async list(p: Principal, q: NotificationListQueryDto): Promise<Page<NotificationItem>> {
    const conds = [eq(notifications.tenantId, p.tenantId), eq(notifications.userId, p.userId)];
    if (q.unread === true) conds.push(isNull(notifications.readAt));
    if (q.cursor) {
      conds.push(
        sql`(${notifications.createdAt}, ${notifications.id}) < (select c.created_at, c.id from notifications c where c.id = ${q.cursor} and c.user_id = ${p.userId})`,
      );
    }
    const rows = await this.db
      .tx()
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(sql`${notifications.createdAt} desc nulls last`, sql`${notifications.id} desc nulls last`)
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(toItem);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  unreadCount(userId: string): Promise<number> {
    return unreadCount(this.db.tx(), userId);
  }

  /** Idempotent; another user's row is as unknown as a made-up id. */
  async markRead(userId: string, id: string): Promise<void> {
    const tx = this.db.tx();
    const [row] = await tx
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    if (!row) throw new AppError('NOT_FOUND');
    if (!row.readAt) await tx.update(notifications).set({ readAt: this.clock.now() }).where(eq(notifications.id, id));
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db
      .tx()
      .update(notifications)
      .set({ readAt: this.clock.now() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  /**
   * Token claim (spec §6.4): rows with this token that belong to anyone else, in any tenant, are deleted first through
   * the platform pool (RLS would hide other tenants), then the caller's row is upserted and re-enabled.
   */
  async registerDevice(p: Principal, input: RegisterPushDeviceDto): Promise<void> {
    await this.db.platform
      .delete(pushDevices)
      .where(and(eq(pushDevices.expoToken, input.expoToken), or(ne(pushDevices.tenantId, p.tenantId), ne(pushDevices.userId, p.userId))));
    const now = this.clock.now();
    await this.db
      .tx()
      .insert(pushDevices)
      .values({ tenantId: p.tenantId, userId: p.userId, expoToken: input.expoToken, platform: input.platform, createdAt: now, lastSeenAt: now })
      .onConflictDoUpdate({ target: pushDevices.expoToken, set: { platform: input.platform, lastSeenAt: now, disabledAt: null } });
  }

  /** The caller's own row only; 204 whether or not it existed. */
  async removeDevice(p: Principal, token: string): Promise<void> {
    await this.db
      .tx()
      .delete(pushDevices)
      .where(and(eq(pushDevices.expoToken, token), eq(pushDevices.userId, p.userId)));
  }

  async updatePreferences(p: Principal, input: UpdatePreferencesDto): Promise<Preferences> {
    const [row] = await this.db
      .tx()
      .update(users)
      .set({ emailNotifications: input.emailNotifications, updatedAt: this.clock.now() })
      .where(eq(users.id, p.userId))
      .returning({ emailNotifications: users.emailNotifications });
    return { emailNotifications: row!.emailNotifications };
  }
}
