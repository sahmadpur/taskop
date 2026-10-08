import { Injectable } from '@nestjs/common';
import { eq, or, type SQL, sql } from 'drizzle-orm';
import { users } from '../db/schema';
import type { Principal } from './request';

@Injectable()
export class ScopeService {
  /** Restricts a query on `users` to the rows the principal's data scope allows. */
  usersFilter(p: Pick<Principal, 'userId' | 'dataScope'>): SQL | undefined {
    switch (p.dataScope) {
      case 'all':
        return undefined;
      case 'own':
        return eq(users.id, p.userId);
      case 'subordinates':
        return sql`${users.id} in (
          with recursive chain as (
            select u.id from users u where u.id = ${p.userId}
            union
            select u.id from users u join chain c on u.manager_id = c.id
          ) select id from chain)`;
      case 'site_subtree':
        return or(
          eq(users.id, p.userId),
          sql`exists (
            select 1 from user_sites us
            join sites s on s.id = us.site_id
            where us.user_id = ${users.id}
              and exists (
                select 1 from user_sites mine
                join sites ms on ms.id = mine.site_id
                where mine.user_id = ${p.userId} and s.path <@ ms.path))`,
        );
    }
  }
}
