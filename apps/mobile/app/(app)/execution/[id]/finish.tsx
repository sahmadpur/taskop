import { useLocalSearchParams } from 'expo-router';
import { FinishOrResubmit } from '@/features/execution/resubmit-screen';

/** `id` is the OCCURRENCE id; the screen resolves the occurrence's current execution itself. A run sent back ends on the Resubmit screen. */
export default function FinishRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FinishOrResubmit key={id} occurrenceId={id} />;
}
