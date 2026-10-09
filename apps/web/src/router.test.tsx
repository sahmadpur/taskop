import type { PlatformLoginResult } from '@taskop/contracts';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { platformApi, platformSession } from '@/features/platform/platform-session';
import { renderWithProviders } from '@/test/render';
import { routeTree } from './router';

const TENANT = '11111111-1111-4111-8111-111111111111';
const admin = { id: 'a1', email: 'a@taskop.az', fullName: 'Admin' } as PlatformLoginResult['admin'];

function renderAt(path: string) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  renderWithProviders(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await platformSession.signOut();
});

describe('platform routes', () => {
  it('redirects to the login page when signed out', async () => {
    const router = renderAt('/platform/templates');
    await waitFor(() => expect(router.state.location.pathname).toBe('/platform/login'));
  });

  it('renders the in-tenant workspace banner for a signed-in admin', async () => {
    await platformSession.signIn({ accessToken: 'x', admin } as PlatformLoginResult);
    vi.spyOn(platformApi.tenants, 'list').mockResolvedValue({
      items: [{ id: TENANT, name: 'Acme MMC' }],
      nextCursor: null,
    } as never);
    vi.spyOn(platformApi, 'inTenant').mockReturnValue({
      checklists: { list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) },
      templates: { list: vi.fn().mockResolvedValue([]) },
    } as never);
    const router = renderAt(`/platform/tenants/${TENANT}/checklists`);
    expect(await screen.findByText(/«Acme MMC» təşkilatında işləyirsiniz/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/platform/tenants/${TENANT}/checklists`);
  });
});
