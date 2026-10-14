import { randomUUID } from 'node:crypto';
import type { PushData } from '@taskop/contracts';
import { Expo, type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk';
import type { AppConfig } from '../config/config';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** One Expo message per delivery (spec §6.1 step 5). */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: PushData;
  sound: 'default';
  /** The Android channel the phone creates at startup (Part 2). */
  channelId: 'default';
  priority: 'default' | 'high';
  badge: number;
}

export type PushTicket = { ok: true; id: string } | { ok: false; error: string | null; message: string };
export type PushReceipt = { ok: true } | { ok: false; error: string | null; message: string };

export interface PushSender {
  /** One ticket per message, in order. Throws when the request itself fails (HTTP, 429 after the SDK's retries). */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  /** Receipts by ticket id; ids Expo does not know (yet) are missing from the map. */
  receipts(ids: string[]): Promise<Map<string, PushReceipt>>;
}

/** The part of the SDK's Expo client this module uses, so tests can stand in for it. */
export interface ExpoClientLike {
  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][];
  sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
  chunkPushNotificationReceiptIds(ids: string[]): string[][];
  getPushNotificationReceiptsAsync(ids: string[]): Promise<{ [id: string]: ExpoPushReceipt }>;
}

const toTicket = (t: ExpoPushTicket): PushTicket => (t.status === 'ok' ? { ok: true, id: t.id } : { ok: false, error: t.details?.error ?? null, message: t.message });
const toReceipt = (r: ExpoPushReceipt): PushReceipt => (r.status === 'ok' ? { ok: true } : { ok: false, error: r.details?.error ?? null, message: r.message });

/** Expo Push Service (spec §6.2). APNs and FCM credentials live in the Expo project, not here. */
export class ExpoPushSender implements PushSender {
  constructor(private readonly client: ExpoClientLike) {}

  static create(accessToken?: string): ExpoPushSender {
    return new ExpoPushSender(new Expo(accessToken ? { accessToken } : {}));
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (const chunk of this.client.chunkPushNotifications(messages.map((m) => ({ ...m })))) {
      tickets.push(...(await this.client.sendPushNotificationsAsync(chunk)).map(toTicket));
    }
    return tickets;
  }

  async receipts(ids: string[]): Promise<Map<string, PushReceipt>> {
    const out = new Map<string, PushReceipt>();
    if (!ids.length) return out;
    for (const chunk of this.client.chunkPushNotificationReceiptIds(ids)) {
      const page = await this.client.getPushNotificationReceiptsAsync(chunk);
      for (const id of chunk) if (page[id]) out.set(id, toReceipt(page[id]));
    }
    return out;
  }
}

/** Records pushes instead of sending them: tests, and NOTIFICATIONS_PUSH_ENABLED=false. */
export class FakePushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  failWith: Error | null = null;
  ticketFor: (m: PushMessage) => PushTicket = () => ({ ok: true, id: `ticket-${randomUUID()}` });
  receiptFor: (id: string) => PushReceipt | undefined = () => ({ ok: true });
  private gate: { reached: () => void; open: Promise<void> } | null = null;

  /** Holds the next send() before it records or fails: `reached` resolves once it waits, `release()` lets it go on. */
  hold(): { reached: Promise<void>; release: () => void } {
    let reached!: () => void;
    let release!: () => void;
    const reachedPromise = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const open = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.gate = { reached, open };
    return { reached: reachedPromise, release };
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const gate = this.gate;
    if (gate) {
      this.gate = null;
      gate.reached();
      await gate.open;
    }
    if (this.failWith) throw this.failWith;
    this.sent.push(...messages);
    return messages.map((m) => this.ticketFor(m));
  }

  async receipts(ids: string[]): Promise<Map<string, PushReceipt>> {
    const out = new Map<string, PushReceipt>();
    for (const id of ids) {
      const r = this.receiptFor(id);
      if (r) out.set(id, r);
    }
    return out;
  }

  reset(): void {
    this.sent.length = 0;
    this.failWith = null;
    this.gate = null;
    this.ticketFor = () => ({ ok: true, id: `ticket-${randomUUID()}` });
    this.receiptFor = () => ({ ok: true });
  }
}

export function pushSenderFor(config: AppConfig): PushSender {
  return config.NOTIFICATIONS_PUSH_ENABLED ? ExpoPushSender.create(config.EXPO_ACCESS_TOKEN) : new FakePushSender();
}
