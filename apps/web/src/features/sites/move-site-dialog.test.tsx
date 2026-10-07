import type { SiteDto } from '@taskop/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { MoveSiteDialog } from './move-site-dialog';

const s = (id: string, path: string, name: string): SiteDto => ({
  id, path, name, parentId: null, typeId: 't', address: null, active: true, depth: path.split('.').length - 1,
});
const sites = [s('a', 'a', 'Alfa'), s('a1', 'a.a1', 'Zona 1'), s('b', 'b', 'Bravo')];

describe('MoveSiteDialog', () => {
  it('offers only valid targets and submits the choice', async () => {
    const onMove = vi.fn();
    renderWithProviders(<MoveSiteDialog site={sites[0]!} sites={sites} open onOpenChange={vi.fn()} onMove={onMove} />);
    const select = screen.getByLabelText('Yeni yer');
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(['— Ən üst səviyyə —', 'Bravo']);
    await userEvent.selectOptions(select, 'b');
    await userEvent.click(screen.getByRole('button', { name: 'Köçür' }));
    expect(onMove).toHaveBeenCalledWith('b');
  });
});
