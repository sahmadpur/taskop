import type { AssignmentListQuery, OccurrenceDto, OccurrenceListQuery } from '@taskop/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export const useShifts = (siteId?: string | null) =>
  useQuery({ queryKey: ['shifts', siteId ?? 'all'], queryFn: () => api.shifts.list(siteId ? { siteId } : {}) });

export const useSiteUsers = (siteId: string | null) =>
  useQuery({
    queryKey: ['users', 'site', siteId],
    queryFn: async () => (await api.users.list({ siteId: siteId!, status: 'active', limit: 200 })).items,
    enabled: Boolean(siteId),
  });

/** Only active checklists with a published version can be assigned (spec §4.2). */
export const useAssignableChecklists = () =>
  useQuery({
    queryKey: ['checklists', 'assignable'],
    queryFn: async () => (await api.checklists.list({ status: 'active', limit: 200 })).items.filter((c) => c.currentVersionNumber !== null),
  });

export const useRoster = (siteId: string | null, from: string, to: string) =>
  useQuery({ queryKey: ['roster', siteId, from, to], queryFn: () => api.roster.get({ siteId: siteId!, from, to }), enabled: Boolean(siteId) });

export const useAssignments = (filters: AssignmentListQuery, enabled = true) =>
  useQuery({ queryKey: ['assignments', 'list', filters], queryFn: () => api.assignments.list({ ...filters, limit: 200 }), enabled });

export const useAssignment = (id: string | undefined) =>
  useQuery({ queryKey: ['assignments', 'detail', id], queryFn: () => api.assignments.get(id!), enabled: Boolean(id) });

/** Follows nextCursor so a busy week is never cut off. */
export const useOccurrences = (filters: Omit<OccurrenceListQuery, 'cursor' | 'limit'>) =>
  useQuery({
    queryKey: ['occurrences', 'list', filters],
    queryFn: async () => {
      const all: OccurrenceDto[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.occurrences.list({ ...filters, limit: 200, cursor });
        all.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return all;
    },
  });

export const useOccurrence = (id: string | null) =>
  useQuery({ queryKey: ['occurrences', 'detail', id], queryFn: () => api.occurrences.get(id!), enabled: Boolean(id) });
