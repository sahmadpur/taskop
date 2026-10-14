import { TeamGate } from '@/features/team/team-gate';
import { TeamScreen } from '@/features/team/team-screen';

export default function TeamRoute() {
  return (
    <TeamGate>
      <TeamScreen />
    </TeamGate>
  );
}
