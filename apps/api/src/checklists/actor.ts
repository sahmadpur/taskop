import type { DbService } from '../db/db.service';

/** Who is acting in the current tenant transaction: a tenant user or a platform admin (FR-24.03). */
export function actorColumns(db: DbService): { userId: string | null; platformAdminId: string | null } {
  const { userId, platformAdminId } = db.context();
  return platformAdminId ? { userId: null, platformAdminId } : { userId, platformAdminId: null };
}
