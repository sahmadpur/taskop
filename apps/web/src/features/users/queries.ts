import type { UserListQuery } from '@taskop/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export type UserFilters = Pick<UserListQuery, 'q' | 'status' | 'roleId' | 'kind'>;

export const useUsersInfinite = (filters: UserFilters) =>
  useInfiniteQuery({
    queryKey: ['users', 'list', filters],
    queryFn: ({ pageParam }) => api.users.list({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useUser = (id: string) => useQuery({ queryKey: ['users', id], queryFn: () => api.users.get(id) });
