import { useLocalSearchParams } from 'expo-router';
import { FinishScreen } from '@/features/execution/finish-screen';

/** `id` is the OCCURRENCE id; the screen resolves the occurrence's current execution itself. */
export default function FinishRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FinishScreen key={id} occurrenceId={id} />;
}
