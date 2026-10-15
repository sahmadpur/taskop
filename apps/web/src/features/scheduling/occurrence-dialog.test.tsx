import { az } from '@taskop/i18n';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceDetail } from '@/features/executions/fixtures';
import { renderWithRouter } from '@/test/router';
import { OccurrenceDialog } from './occurrence-dialog';

const mocks = vi.hoisted(() => ({ api: { occurrences: { get: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useCan: () => false, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.occurrences.get.mockResolvedValue(occurrenceDetail({ status: 'pending' }));
});

describe('OccurrenceDialog', () => {
  it('has the overview, execution, audit and corrections tabs and opens the one asked for', async () => {
    renderWithRouter(<OccurrenceDialog id="o1" onClose={vi.fn()} initialTab="corrections" />);
    const dialog = await screen.findByRole('dialog', { name: 'Açılış' });
    expect(within(dialog).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Ümumi', 'İcra', az.audits.audit, az.corrections.title]);
    expect(within(dialog).getByRole('tab', { name: az.corrections.title })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByText('Bu icra hələ başlanmayıb.')).toBeInTheDocument();
  });
});
