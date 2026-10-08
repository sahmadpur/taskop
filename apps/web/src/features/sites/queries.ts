import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export const useSites = () => useQuery({ queryKey: ['sites'], queryFn: api.sites.list });
export const useSiteTypes = () => useQuery({ queryKey: ['site-types'], queryFn: api.siteTypes.list });
