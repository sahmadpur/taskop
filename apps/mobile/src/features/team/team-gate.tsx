import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { canSeeTeam } from './team-rules';

/**
 * Decision 1: the Team routes check access themselves, because a hidden tab is still reachable by URL (a deep link, a
 * typed route). Without access the viewer lands on Home. A profile refresh that removes access redirects an open screen.
 */
export function TeamGate({ children }: { children: ReactNode }) {
  const s = useSession();
  if (s.status !== 'authenticated') return null;
  if (!canSeeTeam(s.me)) return <Redirect href="/" />;
  return <>{children}</>;
}
