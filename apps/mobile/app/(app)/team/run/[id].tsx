import { useLocalSearchParams } from 'expo-router';
import { TeamRunScreen } from '@/features/team/run-screen';
import { TeamGate } from '@/features/team/team-gate';

/** `id` is the OCCURRENCE id (decision 10). */
export default function TeamRunRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // A new key per run, so nothing from one run's screen stays on the next.
  return (
    <TeamGate>
      <TeamRunScreen key={id} occurrenceId={id} />
    </TeamGate>
  );
}
