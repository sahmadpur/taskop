import { MEDIA_LIMITS, type ProblemListQuery } from '@taskop/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

/** Presigned GETs live 5 minutes (spec §6.7). Reuse one for 4, so a cached URL always has a minute left. */
export const MEDIA_URL_FRESH_MS = (MEDIA_LIMITS.downloadUrlTtlSeconds - 60) * 1000;

export const useExecution = (id: string | null) =>
  useQuery({ queryKey: ['executions', 'detail', id], queryFn: () => api.executions.get(id!), enabled: Boolean(id) });

/** Only for uploaded media: the API refuses a URL for pending ones (MEDIA_NOT_FOUND_IN_STORAGE). */
export const useMediaUrl = (id: string, enabled = true) =>
  useQuery({
    queryKey: ['media', 'url', id],
    queryFn: () => api.media.url(id),
    enabled,
    staleTime: MEDIA_URL_FRESH_MS,
    gcTime: MEDIA_URL_FRESH_MS,
  });

export type ProblemFilters = Omit<ProblemListQuery, 'cursor' | 'limit'>;

/** Newest first, 50 per page; the page asks for more with "Daha çox göstər". */
export const useProblems = (filters: ProblemFilters, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ['problems', filters],
    queryFn: ({ pageParam }) => api.problems.list({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

/** Every checklist of the tenant, archived ones included, for the problems filter. */
export const useChecklistOptions = () =>
  useQuery({ queryKey: ['checklists', 'options'], queryFn: async () => (await api.checklists.list({ limit: 200 })).items });
