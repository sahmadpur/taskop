import { useLocalSearchParams } from 'expo-router';
import { ReviewScreen } from '@/features/tasks/review-screen';

export default function ReviewRoute() {
  const { id, n } = useLocalSearchParams<{ id: string; n?: string }>();
  // The nonce makes every visit to the same task a fresh screen: nothing from a decision made earlier stays on it.
  return <ReviewScreen key={`${id}:${n ?? ''}`} taskId={id} />;
}
