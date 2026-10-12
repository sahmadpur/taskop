import { useLocalSearchParams } from 'expo-router';
import { ReviewScreen } from '@/features/tasks/review-screen';

export default function ReviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReviewScreen key={id} taskId={id} />;
}
