import { Injectable } from '@nestjs/common';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { assignments, occurrences, shiftRoster, sites, users } from '../db/schema';
import type { Actor } from './actor';

const chain = (userId: string) => sql`(with recursive chain as (
    select u.id from users u where u.id = ${userId}
    union
    select u.id from users u join chain c on u.manager_id = c.id
  ) select id from chain)`;

/** The site in `siteCol` lies under one of the user's own sites (Foundation §4.4). */
const inSubtree = (userId: string, siteCol: AnyPgColumn) => sql`exists (
    select 1 from user_sites mine
    join sites ms on ms.id = mine.site_id
    join sites target on target.id = ${siteCol}
    where mine.user_id = ${userId} and target.path <@ ms.path)`;

const failClosed = (scope: never): never => {
  throw new Error(`Unhandled data scope: ${String(scope)}`);
};

/** Data scope for scheduling rows (spec §6). A null actor is a platform admin: no filter. */
@Injectable()
export class SchedulingScope {
  constructor(private readonly db: DbService) {}

  assignments(a: Actor): SQL | undefined {
    if (!a || a.dataScope === 'all') return undefined;
    switch (a.dataScope) {
      case 'site_subtree':
        return inSubtree(a.userId, assignments.siteId);
      case 'subordinates':
        return sql`exists (select 1 from assignment_assignees aa where aa.assignment_id = ${assignments.id} and aa.user_id in ${chain(a.userId)})`;
      case 'own':
        return sql`exists (select 1 from assignment_assignees aa where aa.assignment_id = ${assignments.id} and aa.user_id = ${a.userId})`;
      default:
        return failClosed(a.dataScope);
    }
  }

  occurrences(a: Actor): SQL | undefined {
    if (!a || a.dataScope === 'all') return undefined;
    switch (a.dataScope) {
      case 'site_subtree':
        return inSubtree(a.userId, occurrences.siteId);
      case 'subordinates':
        return sql`exists (select 1 from occurrence_assignees oa where oa.occurrence_id = ${occurrences.id} and oa.user_id in ${chain(a.userId)})`;
      case 'own':
        return sql`exists (select 1 from occurrence_assignees oa where oa.occurrence_id = ${occurrences.id} and oa.user_id = ${a.userId})`;
      default:
        return failClosed(a.dataScope);
    }
  }

  /** Roster rows; the site itself is checked with assertSiteReadable. */
  roster(a: Actor): SQL | undefined {
    if (!a || a.dataScope === 'all' || a.dataScope === 'site_subtree') return undefined;
    return a.dataScope === 'own' ? eq(shiftRoster.userId, a.userId) : sql`${shiftRoster.userId} in ${chain(a.userId)}`;
  }

  /** The people listed on a roster. */
  rosterUsers(a: Actor): SQL | undefined {
    if (!a || a.dataScope === 'all' || a.dataScope === 'site_subtree') return undefined;
    return a.dataScope === 'own' ? eq(users.id, a.userId) : sql`${users.id} in ${chain(a.userId)}`;
  }

  /** Reading a site's roster: site_subtree managers only for their sites; narrower scopes see their own rows. */
  async assertSiteReadable(a: Actor, siteId: string): Promise<void> {
    if (a?.dataScope === 'site_subtree') await this.assertSiteWritable(a, siteId);
  }

  /** Writes need the site inside the actor's scope: all, or site_subtree containing it (spec §6). */
  async assertSiteWritable(a: Actor, siteId: string): Promise<void> {
    if (!a || a.dataScope === 'all') return;
    if (a.dataScope === 'site_subtree') {
      const [row] = await this.db
        .tx()
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, siteId), inSubtree(a.userId, sites.id)));
      if (row) return;
    }
    throw new AppError('SITE_OUT_OF_SCOPE');
  }
}
