import type { ChecklistListQuery, TemplateListQuery } from '@taskop/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useWorkspace } from './workspace';

export function useChecklistPages(filters: Omit<ChecklistListQuery, 'cursor' | 'limit'>) {
  const ws = useWorkspace();
  return useInfiniteQuery({
    queryKey: [ws.scope, 'checklists', 'list', filters],
    queryFn: ({ pageParam }) => ws.checklists.list({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useChecklist(id: string) {
  const ws = useWorkspace();
  return useQuery({ queryKey: [ws.scope, 'checklists', id], queryFn: () => ws.checklists.get(id) });
}

export function useTemplates(query: TemplateListQuery, enabled = true) {
  const ws = useWorkspace();
  return useQuery({ queryKey: [ws.scope, 'templates', query], queryFn: () => ws.templates.list(query), enabled });
}
