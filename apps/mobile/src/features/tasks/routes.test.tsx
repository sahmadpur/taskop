import { render } from '@testing-library/react-native';
import ReviewRoute from '../../../app/(app)/review/[id]';
import NewTaskRoute from '../../../app/(app)/task/new';

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));

// Counts mounts and unmounts: a screen that the route re-keys is a new instance.
const mockLog: string[] = [];
jest.mock('@/features/tasks/create-task-screen', () => ({
  CreateTaskScreen: () => {
    const { useEffect, useRef } = jest.requireActual<typeof import('react')>('react');
    const id = useRef(`form-${mockLog.length}`).current;
    useEffect(() => {
      mockLog.push(`mount ${id}`);
      return () => void mockLog.push(`unmount ${id}`);
    }, [id]);
    return null;
  },
}));
jest.mock('@/features/tasks/review-screen', () => ({
  ReviewScreen: ({ taskId }: { taskId: string }) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      mockLog.push(`mount review ${taskId}`);
      return () => void mockLog.push(`unmount review ${taskId}`);
    }, [taskId]);
    return null;
  },
}));

beforeEach(() => {
  mockLog.length = 0;
});

describe('task routes', () => {
  it('give each visit to the new-task route its own form instance', async () => {
    mockParams = { n: 'a' };
    const view = await render(<NewTaskRoute />);
    await view.rerender(<NewTaskRoute />);
    expect(mockLog).toEqual(['mount form-0']);
    mockParams = { n: 'b' };
    await view.rerender(<NewTaskRoute />);
    expect(mockLog).toEqual(['mount form-0', 'unmount form-0', 'mount form-1']);
  });

  it('give each visit to a task’s review its own screen, and keep one while the visit lasts', async () => {
    mockParams = { id: 't1', n: 'a' };
    const view = await render(<ReviewRoute />);
    await view.rerender(<ReviewRoute />);
    expect(mockLog).toEqual(['mount review t1']);
    mockParams = { id: 't1', n: 'b' };
    await view.rerender(<ReviewRoute />);
    expect(mockLog).toEqual(['mount review t1', 'unmount review t1', 'mount review t1']);
  });
});
