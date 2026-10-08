import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { renderWithProviders } from '@/test/render';
import { GlobalTemplatesPage } from './global-templates-page';

const mocks = vi.hoisted(() => ({
  globalTemplates: { list: vi.fn(), create: vi.fn(), publish: vi.fn(), unpublish: vi.fn() },
  navigate: vi.fn(),
}));
vi.mock('./platform-session', () => ({ platformApi: { globalTemplates: mocks.globalTemplates } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));

const row = (published: boolean) => ({
  id: 'g1',
  name: 'Mətbəx',
  description: null,
  category: 'restaurant',
  published,
  sortOrder: 1,
  itemCount: 0,
  updatedAt: '2026-10-08T08:00:00.000Z',
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe('GlobalTemplatesPage', () => {
  it('publishes and shows validation errors from the API', async () => {
    const { ApiError } = await import('@taskop/api-client');
    mocks.globalTemplates.list.mockResolvedValue([row(false)]);
    mocks.globalTemplates.publish.mockRejectedValue(
      new ApiError(422, 'CHECKLIST_INVALID_CONTENT', 'errors.CHECKLIST_INVALID_CONTENT'),
    );
    renderWithProviders(
      <>
        <GlobalTemplatesPage />
        <Toaster />
      </>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Dərc et' }));
    expect(await screen.findByText('Yoxlama vərəqəsində düzəldilməli xətalar var.')).toBeInTheDocument();
  });

  it('creates a template and opens the editor', async () => {
    mocks.globalTemplates.list.mockResolvedValue([]);
    mocks.globalTemplates.create.mockResolvedValue({ id: 'g2' });
    renderWithProviders(
      <>
        <GlobalTemplatesPage />
        <Toaster />
      </>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni şablon' }));
    await userEvent.type(screen.getByLabelText('Ad'), 'Anbar');
    await userEvent.selectOptions(screen.getByLabelText('Kateqoriya'), 'warehouse');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() =>
      expect(mocks.globalTemplates.create).toHaveBeenCalledWith({ name: 'Anbar', category: 'warehouse' }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/platform/templates/g2' });
  });
});
