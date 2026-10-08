import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export const useTeams = (enabled = true) => useQuery({ queryKey: ['teams'], queryFn: api.teams.list, enabled });
export const useActiveUsers = (enabled: boolean) =>
  useQuery({
    queryKey: ['users', 'active-all'],
    queryFn: async () => (await api.users.list({ status: 'active', limit: 200 })).items,
    enabled,
  });
