import { Injectable } from '@nestjs/common';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { AppError } from '../common/app-error';
import type { ScopeHolder } from '../common/request';
import { DbService } from '../db/db.service';
import { assignments, occurrences, shiftRoster, sites, users } from '../db/schema';
import type { Actor } from './actor';

export const chain = (userId: string) => sql`(with recursive chain as (
    select u.id from users u where u.id = ${userId}
    union
    select u.id from users u join chain c on u.manager_id = c.id
  ) select id from chain)`;

/**
 * The site in `siteCol` lies under one of the user's own sites (Foundation §4.4). It yields NULL, not false, when the
 * site column is NULL: safe in WHERE, AND/OR and under `coalesce(...)`, but never negate it without a `coalesce`.
 * The visible sites are an uncorrelated
 * subquery, so Postgres hashes them once; a correlated `exists` re-ran per row and took about a second over 73,200 runs.
 */
export const inSubtree = (userId: string, siteCol: AnyPgColumn) => sql`${siteCol} in (
    select target.id from user_sites mine
    join sites ms on ms.id = mine.site_id
    join sites target on target.path <@ ms.path
    where mine.user_id = ${userId})`;

const failClosed = (scope: never): never => {
  throw new Error(`Unhandled data scope: ${String(scope)}`);
};

/** Data scope for scheduling rows (spec §6). A null actor is a platform admin: no filter. */
@Injectable()
export class SchedulingScope {
  constructor(private readonly db: DbService) {}

  assignments(a: ScopeHolder | null): SQL | undefined {
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

  occurrences(a: ScopeHolder | null): SQL | undefined {
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

  /**
   * The sites whose name a viewer may read, as SQL over `sites`: everything for `all`, the subtree for site_subtree,
   * and for narrower scopes the sites that hold a run inside their scope (the sites their report rows name).
   */
  readableSites(a: ScopeHolder | null): SQL {
    if (!a || a.dataScope === 'all') return sql`true`;
    if (a.dataScope === 'site_subtree') return inSubtree(a.userId, sites.id);
    return sql`exists (select 1 from occurrences where occurrences.site_id = ${sites.id} and ${this.occurrences(a)!})`;
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

  /** The sites a write may name, as SQL over `sites`: the filter form of assertSiteWritable (all, or site_subtree containing it). */
  writableSites(a: Actor): SQL {
    if (!a || a.dataScope === 'all') return sql`true`;
    return a.dataScope === 'site_subtree' ? inSubtree(a.userId, sites.id) : sql`false`;
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
