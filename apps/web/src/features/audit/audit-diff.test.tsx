import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { AuditDiff, diffEntries } from './audit-diff';

describe('diffEntries', () => {
  it('lists only changed top-level keys', () => {
    expect(diffEntries({ name: 'A', tz: 'Asia/Baku', n: [1] }, { name: 'B', tz: 'Asia/Baku', n: [1] })).toEqual([{ key: 'name', before: 'A', after: 'B' }]);
  });
  it('treats a creation (no before) as all keys added', () => {
    expect(diffEntries(null, { name: 'A' })).toEqual([{ key: 'name', before: undefined, after: 'A' }]);
  });
  it('handles non-object payloads', () => {
    expect(diffEntries(null, null)).toEqual([]);
  });
});

describe('AuditDiff', () => {
  it('renders before and after values', () => {
    renderWithProviders(<AuditDiff before={{ status: 'active' }} after={{ status: 'deactivated' }} />);
    expect(screen.getByText('status')).toBeInTheDocument();
    expect(screen.getByText('"active"')).toBeInTheDocument();
    expect(screen.getByText('"deactivated"')).toBeInTheDocument();
  });
});
