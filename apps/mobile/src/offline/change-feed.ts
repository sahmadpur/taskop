/** "Local data changed": store writes and sync results emit; live queries and the sync status re-read. */
export interface ChangeFeed {
  emit(): void;
  subscribe(listener: () => void): () => void;
}

export function createChangeFeed(): ChangeFeed {
  const listeners = new Set<() => void>();
  return {
    emit: () => listeners.forEach((l) => l()),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
