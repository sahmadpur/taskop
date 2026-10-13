import { useLocalSearchParams } from 'expo-router';
import { TaskScreen } from '@/features/tasks/task-screen';

export default function TaskRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // A new key per task, so a capture in progress never lands on another task.
  return <TaskScreen key={id} taskId={id} />;
}
