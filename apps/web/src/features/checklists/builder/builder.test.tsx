import { blankContent, type ChecklistContent, newItem, newSection } from '@taskop/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { Builder } from './builder';

function validContent(): ChecklistContent {
  const item = newItem('text');
  item.label = 'Ad';
  return { ...blankContent(), sections: [{ ...newSection('Bölmə'), items: [item] }] };
}

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.useRealTimers());

describe('Builder', () => {
  it('publish flushes before publishing', async () => {
    const save = vi.fn(async (_c: ChecklistContent, revision: number) => ({ revision: revision + 1, issues: [] }));
    const onPublish = vi.fn(async () => undefined);
    renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={4} readOnly={false} save={save} onPublish={onPublish} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Bölmənin adı'), { target: { value: 'Yeni ad' } });
    await userEvent.click(screen.getByRole('button', { name: 'Dərc et' }));
    await userEvent.type(screen.getByLabelText('Dəyişiklik qeydi (istəyə bağlı)'), 'Ad dəyişdi');
    await userEvent.click(screen.getAllByRole('button', { name: 'Dərc et' }).at(-1)!);
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(5, 'Ad dəyişdi'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].sections[0]!.title).toBe('Yeni ad');
  });

  it('blocks publishing while there are issues and lists them', async () => {
    renderWithProviders(<Builder title="X" initialContent={blankContent()} initialRevision={1} readOnly={false} save={vi.fn()} onPublish={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Dərc et' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '2 xəta' }));
    expect(within(await screen.findByRole('menu')).getByText('Bölmənin adını yazın.')).toBeInTheDocument();
  });

  it('read-only and no-publish modes', () => {
    const save = vi.fn();
    const { unmount } = renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={1} readOnly save={save} onPublish={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByLabelText('Bölmənin adı')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Dərc et' })).toBeNull();
    expect(screen.getByText('Yalnız baxış')).toBeInTheDocument();
    unmount();
    renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={1} readOnly={false} save={save} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Dərc et' })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('undoes with the button and keyboard', async () => {
    renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={1} readOnly={false} save={vi.fn(async () => ({ revision: 2, issues: [] }))} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Bölmənin adı'), { target: { value: 'Z' } });
    await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
    expect(screen.getByLabelText('Bölmənin adı')).toHaveValue('Bölmə');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(screen.getByLabelText('Bölmənin adı')).toHaveValue('Z');
  });

  it('shows the conflict banner and reload action', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { ApiError } = await import('@taskop/api-client');
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'CHECKLIST_DRAFT_CONFLICT', 'x'));
    const onReload = vi.fn();
    vi.stubGlobal('confirm', () => true);
    renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={1} readOnly={false} save={save} onReload={onReload} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Bölmənin adı'), { target: { value: 'Z' } });
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(screen.getByRole('alert')).toHaveTextContent('Bu qaralama başqa yerdə dəyişdirilib.');
    await userEvent.click(screen.getByRole('button', { name: 'Yenidən yüklə' }));
    expect(onReload).toHaveBeenCalled();
  });

  it('ignores keyboard undo while blocked by a conflict', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { ApiError } = await import('@taskop/api-client');
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'CHECKLIST_DRAFT_CONFLICT', 'x'));
    renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={1} readOnly={false} save={save} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Bölmənin adı'), { target: { value: 'Z' } });
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByLabelText('Bölmənin adı')).toHaveValue('Z');
  });

  it('ignores keyboard undo while the preview is open', async () => {
    renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={1} readOnly={false} save={vi.fn(async () => ({ revision: 2, issues: [] }))} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Bölmənin adı'), { target: { value: 'Z' } });
    await userEvent.click(screen.getByRole('button', { name: 'Önizləmə' }));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await userEvent.click(screen.getByRole('button', { name: 'Redaktora qayıt' }));
    expect(screen.getByLabelText('Bölmənin adı')).toHaveValue('Z');
  });

  it('ignores keyboard undo while the publish dialog is open', async () => {
    renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={1} readOnly={false} save={vi.fn(async () => ({ revision: 2, issues: [] }))} onPublish={vi.fn()} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Bölmənin adı'), { target: { value: 'Z' } });
    await userEvent.click(screen.getByRole('button', { name: 'Dərc et' }));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await userEvent.click(screen.getByRole('button', { name: 'Ləğv et' }));
    expect(screen.getByLabelText('Bölmənin adı')).toHaveValue('Z');
  });
});
