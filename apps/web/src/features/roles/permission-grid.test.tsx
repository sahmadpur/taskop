import type { PermissionKey } from '@taskop/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { PermissionGrid } from './permission-grid';

const catalog = [
  { group: 'users', keys: ['users.view', 'users.manage'] as PermissionKey[] },
  { group: 'audit', keys: ['audit.view'] as PermissionKey[] },
];

describe('PermissionGrid', () => {
  it('toggles permissions', async () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionGrid catalog={catalog} value={['users.view']} onChange={onChange} held={new Set(['users.view', 'users.manage', 'audit.view'])} disabled={false} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'İstifadəçiləri idarə etmək' }));
    expect(onChange).toHaveBeenCalledWith(['users.view', 'users.manage']);
  });

  it('disables keys the actor does not hold, but still allows removing granted ones', () => {
    renderWithProviders(<PermissionGrid catalog={catalog} value={['users.manage']} onChange={vi.fn()} held={new Set(['users.view'])} disabled={false} />);
    expect(screen.getByRole('checkbox', { name: 'Audit jurnalına baxmaq' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'İstifadəçiləri idarə etmək' })).toBeEnabled();
  });

  it('disables everything for locked roles', () => {
    renderWithProviders(<PermissionGrid catalog={catalog} value={[]} onChange={vi.fn()} held={new Set(['users.view'])} disabled />);
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
  });
});
