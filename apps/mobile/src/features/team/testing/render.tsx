import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { OfflineServicesProvider } from '@/offline/context';
import type { OfflineServices } from '@/offline/services';

/** Like the app's client (app/_layout.tsx), minus retries and garbage-collection timers, so Jest sees no open handles. */
export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

export function TeamProviders({ services, client, children }: { services: OfflineServices; client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <OfflineServicesProvider services={services}>{children}</OfflineServicesProvider>
    </QueryClientProvider>
  );
}

/** Renders `ui` under the offline services and a query client (a fresh one unless given). */
export async function renderTeam(services: OfflineServices, ui: ReactElement, client: QueryClient = testQueryClient()) {
  const view = await render(
    <TeamProviders services={services} client={client}>
      {ui}
    </TeamProviders>,
  );
  return { ...view, client };
}

/** A promise a test opens when it wants: holds a request in flight. */
export function gate(): { open: () => void; opened: Promise<void> } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}
