import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { renderWithProviders } from './render';

/** Renders `ui` at every path, so components can use <Link> and useNavigate and tests can read router.state. */
export function renderWithRouter(ui: ReactElement, path = '/', client?: QueryClient) {
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({ getParentRoute: () => root, path: '/', component: () => ui });
  const any = createRoute({ getParentRoute: () => root, path: '$', component: () => ui });
  const router = createRouter({ routeTree: root.addChildren([index, any]), history: createMemoryHistory({ initialEntries: [path] }) });
  renderWithProviders(<RouterProvider router={router} />, client);
  return router;
}
