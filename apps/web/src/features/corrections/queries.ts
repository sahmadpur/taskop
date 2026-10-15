import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export const correctionKeys = {
  /** Invalidated with ['corrections'] by refreshRunViews. */
  history: (executionId: string) => ['corrections', executionId] as const,
};

/** GET /executions/:id/corrections: the original snapshot, the changes, the rework rounds and the diff. */
export const useCorrections = (executionId: string) => useQuery({ queryKey: correctionKeys.history(executionId), queryFn: () => api.corrections.history(executionId) });
