import type { ReactElement } from 'react';
import { type RunCommand, useRunCommand } from '../queries';

/** Renders a run-screen mode with a real `useRunCommand`, as the run screen does (Tasks 8–10). */
export function WithCommand({ viewerId, children }: { viewerId: string; children: (command: RunCommand) => ReactElement }) {
  const command = useRunCommand(viewerId);
  return children(command);
}
