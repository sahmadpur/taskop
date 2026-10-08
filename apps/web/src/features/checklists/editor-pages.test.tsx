import { blankContent, newItem, newSection } from '@taskop/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider } from './workspace';
import { fakeWorkspace, renderInWorkspace } from '@/test/workspace';
import { TemplateEditorPage } from './editor-pages';

const item = newItem('text');
item.label = 'Ad';
const content = { ...blankContent(), sections: [{ ...newSection('Bölmə'), items: [item] }] };
const template = (status: 'active' | 'deactivated') => ({
  id: 't1',
  name: 'Şablon',
  status,
  content,
  revision: 1,
});

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);

describe('TemplateEditorPage', () => {
  it('is read-only for a global template', async () => {
    const ws = fakeWorkspace();
    ws.templates.get.mockResolvedValue(template('active'));
    renderInWorkspace(<TemplateEditorPage source="global" templateId="t1" />, ws);
    expect(await screen.findByText('Yalnız baxış')).toBeInTheDocument();
    expect(screen.getByLabelText('Bölmənin adı')).toBeDisabled();
    expect(ws.templates.saveContent).not.toHaveBeenCalled();
  });

  it('is read-only for a deactivated tenant template', async () => {
    const ws = fakeWorkspace();
    ws.templates.get.mockResolvedValue(template('deactivated'));
    renderInWorkspace(<TemplateEditorPage source="tenant" templateId="t1" />, ws);
    expect(await screen.findByText('Yalnız baxış')).toBeInTheDocument();
    expect(screen.getByLabelText('Bölmənin adı')).toBeDisabled();
  });

  it('is read-only without templates.manage', async () => {
    const ws = fakeWorkspace({ can: { manage: true, publish: true, templates: false } });
    ws.templates.get.mockResolvedValue(template('active'));
    renderInWorkspace(<TemplateEditorPage source="tenant" templateId="t1" />, ws);
    expect(await screen.findByText('Yalnız baxış')).toBeInTheDocument();
  });

  it('is editable for an active tenant template with templates.manage', async () => {
    const ws = fakeWorkspace();
    ws.templates.get.mockResolvedValue(template('active'));
    renderInWorkspace(<TemplateEditorPage source="tenant" templateId="t1" />, ws);
    expect(await screen.findByLabelText('Bölmənin adı')).toBeEnabled();
    expect(screen.queryByText('Yalnız baxış')).toBeNull();
  });

  it('re-fetches on remount instead of mounting stale cached content', async () => {
    const ws = fakeWorkspace();
    let resolveSecond!: (v: unknown) => void;
    ws.templates.get
      .mockResolvedValueOnce({ ...template('active'), name: 'Köhnə' })
      .mockReturnValueOnce(new Promise((r) => (resolveSecond = r)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (
      <QueryClientProvider client={client}>
        <WorkspaceProvider value={ws}>
          <TemplateEditorPage source="tenant" templateId="t1" />
        </WorkspaceProvider>
      </QueryClientProvider>
    );

    const first = render(ui);
    expect(await screen.findByText('Köhnə')).toBeInTheDocument();
    first.unmount();
    // Let the post-unmount garbage collection run (the user navigates elsewhere first).
    await new Promise((r) => setTimeout(r, 10));

    render(ui);
    await waitFor(() => expect(ws.templates.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Köhnə')).toBeNull();
    resolveSecond({ ...template('active'), name: 'Yeni', revision: 2 });
    expect(await screen.findByText('Yeni')).toBeInTheDocument();
  });
});
