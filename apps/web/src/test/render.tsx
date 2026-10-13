import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

/** `client` lets a test seed the cache or set the app's own defaults (staleTime) before rendering. */
export function renderWithProviders(ui: ReactElement, client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
