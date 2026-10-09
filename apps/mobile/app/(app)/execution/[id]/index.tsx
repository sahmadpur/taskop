import { useLocalSearchParams } from 'expo-router';
import { ExecutionScreen } from '@/features/execution/execution-screen';

/** `id` is the OCCURRENCE id; the screen resolves the occurrence's current execution itself. */
export default function ExecutionRoute() {
  const { id, itemId } = useLocalSearchParams<{ id: string; itemId?: string }>();
  // A new key per occurrence, so section and sheet state never leak from one execution to another.
  return <ExecutionScreen key={id} occurrenceId={id} focusItemId={itemId} />;
}
