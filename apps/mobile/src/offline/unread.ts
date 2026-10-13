import { type Db, getMeta } from './db';

/** The unread count of the last sync or inbox read (spec §7.3); 0 before the first one. */
export async function readUnreadNotifications(db: Db): Promise<number> {
  const n = Number(await getMeta(db, 'unreadNotifications'));
  return Number.isInteger(n) && n > 0 ? n : 0;
}
