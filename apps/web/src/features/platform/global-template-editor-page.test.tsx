import { blankContent } from '@taskop/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalTemplateEditorPage } from './global-template-editor-page';

const mocks = vi.hoisted(() => ({
  globalTemplates: { get: vi.fn(), saveContent: vi.fn(), publish: vi.fn(), unpublish: vi.fn() },
}));
vi.mock('./platform-session', () => ({ platformApi: { globalTemplates: mocks.globalTemplates } }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ templateId: 'g1' }),
}));

const tpl = (name: string, revision: number) => ({
  id: 'g1',
  name,
  description: null,
  category: 'restaurant',
  published: false,
  sortOrder: 1,
  itemCount: 0,
  content: blankContent(),
  revision,
  updatedAt: '2026-10-08T08:00:00.000Z',
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe('GlobalTemplateEditorPage', () => {
  it('re-fetches on remount instead of mounting stale cached content', async () => {
    let resolveSecond!: (v: unknown) => void;
    mocks.globalTemplates.get
      .mockResolvedValueOnce(tpl('Köhnə', 1))
      .mockReturnValueOnce(new Promise((r) => (resolveSecond = r)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (
      <QueryClientProvider client={client}>
        <GlobalTemplateEditorPage />
      </QueryClientProvider>
    );

    const first = render(ui);
    expect(await screen.findByText('Köhnə')).toBeInTheDocument();
    first.unmount();
    // Let the post-unmount garbage collection run (the user navigates elsewhere first).
    await new Promise((r) => setTimeout(r, 10));

    render(ui);
    await waitFor(() => expect(mocks.globalTemplates.get).toHaveBeenCalledTimes(2));
    // The cached revision-1 content must not be mounted while the fresh copy loads.
    expect(screen.queryByText('Köhnə')).toBeNull();
    resolveSecond(tpl('Yeni', 2));
    expect(await screen.findByText('Yeni')).toBeInTheDocument();
  });
});
