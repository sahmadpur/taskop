import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export const useSites = (enabled = true) => useQuery({ queryKey: ['sites'], queryFn: api.sites.list, enabled });
export const useSiteTypes = () => useQuery({ queryKey: ['site-types'], queryFn: api.siteTypes.list });
