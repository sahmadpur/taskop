import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { addEmails, EmailListInput, splitEmails } from './email-list-input';

function Harness({ initial = [], max = 3, disabled = false, onList = () => undefined }: { initial?: string[]; max?: number; disabled?: boolean; onList?: (l: string[]) => void }) {
  const [list, setList] = useState<string[]>(initial);
  return (
    <EmailListInput
      id="emails"
      label="Ünvanlar"
      hint="Ən çox 3"
      value={list}
      max={max}
      disabled={disabled}
      onChange={(next) => {
        setList(next);
        onList(next);
      }}
    />
  );
}

describe('addEmails', () => {
  it('splits on commas, semicolons, spaces and new lines and lower-cases', () => {
    expect(splitEmails(' A@acme.az, b@ACME.az;c@acme.az\nd@acme.az  ')).toEqual(['a@acme.az', 'b@acme.az', 'c@acme.az', 'd@acme.az']);
    expect(addEmails(['a@acme.az'], 'B@acme.az', 3)).toEqual({ ok: true, next: ['a@acme.az', 'b@acme.az'] });
  });

  it('adds all or nothing', () => {
    expect(addEmails([], 'a@acme.az, yanlış', 3)).toEqual({ ok: false, issue: 'invalid' });
    expect(addEmails(['a@acme.az'], 'b@acme.az A@acme.az', 3)).toEqual({ ok: false, issue: 'duplicate' });
    expect(addEmails(['a@acme.az', 'b@acme.az'], 'c@acme.az d@acme.az', 3)).toEqual({ ok: false, issue: 'tooMany' });
  });
});

describe('EmailListInput', () => {
  it('adds an address on Enter and on a comma, lower-cased, and removes one', async () => {
    const onList = vi.fn();
    renderWithProviders(<Harness onList={onList} />);
    const input = screen.getByLabelText('Ünvanlar');
    await userEvent.type(input, 'Rehber@Acme.az{Enter}');
    expect(screen.getByText('rehber@acme.az')).toBeInTheDocument();
    expect(input).toHaveValue('');
    await userEvent.type(input, 'audit@acme.az,');
    expect(screen.getByText('audit@acme.az')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sil: rehber@acme.az' }));
    expect(screen.queryByText('rehber@acme.az')).not.toBeInTheDocument();
    expect(onList).toHaveBeenLastCalledWith(['audit@acme.az']);
  });

  it('adds a pasted list, lower-cased', async () => {
    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByLabelText('Ünvanlar'));
    await userEvent.paste('a@acme.az; B@acme.az\nc@acme.az');
    expect(screen.getByLabelText('Ünvanlar')).toHaveValue('');
    for (const e of ['a@acme.az', 'b@acme.az', 'c@acme.az']) expect(screen.getByText(e)).toBeInTheDocument();
  });

  it('keeps a pasted list with a bad address in the field to fix', async () => {
    renderWithProviders(<Harness />);
    const input = screen.getByLabelText('Ünvanlar');
    await userEvent.click(input);
    await userEvent.paste('a@acme.az, yanlış');
    expect(screen.getByText('E-poçt ünvanı düzgün deyil.')).toBeInTheDocument();
    expect(input).toHaveValue('a@acme.az, yanlış');
    expect(screen.queryByText('a@acme.az', { selector: 'li' })).not.toBeInTheDocument();
  });

  it('refuses an invalid address, a duplicate and one over the limit, and keeps the text to fix', async () => {
    renderWithProviders(<Harness initial={['a@acme.az']} max={2} />);
    const input = screen.getByLabelText('Ünvanlar');
    await userEvent.type(input, 'yanlış{Enter}');
    expect(screen.getByText('E-poçt ünvanı düzgün deyil.')).toBeInTheDocument();
    expect(input).toHaveValue('yanlış');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(input);
    expect(screen.queryByText('E-poçt ünvanı düzgün deyil.')).not.toBeInTheDocument();
    await userEvent.type(input, 'A@acme.az{Enter}');
    expect(screen.getByText('Bu ünvan artıq siyahıdadır.')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'b@acme.az{Enter}c@acme.az{Enter}');
    expect(screen.getByText('Ən çox 2 ünvan əlavə etmək olar.')).toBeInTheDocument();
    expect(screen.queryByText('c@acme.az', { selector: 'li' })).not.toBeInTheDocument();
  });

  it('adds what is typed when the field loses focus', async () => {
    const onList = vi.fn();
    renderWithProviders(<Harness onList={onList} />);
    await userEvent.type(screen.getByLabelText('Ünvanlar'), 'x@acme.az');
    await userEvent.tab();
    expect(onList).toHaveBeenLastCalledWith(['x@acme.az']);
  });

  it('only lists the addresses when disabled', () => {
    renderWithProviders(<Harness initial={['a@acme.az']} disabled />);
    expect(screen.getByText('a@acme.az')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
